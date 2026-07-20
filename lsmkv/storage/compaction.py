"""
Compaction Engine — Phase 4.

Merges multiple SSTables into a single, de-duplicated, tombstone-purged file.
Runs as an asyncio background task.

Strategy: Size-Tiered Compaction (STC)
  L0: freshly flushed SSTables (uncompacted)
  L1: result of merging L0 files
  L2: result of merging L1 files (optional for large datasets)

Trigger: when len(L0) >= l0_compaction_trigger, merge all L0 → one L1 file.

K-Way Merge:
  - Open one sorted iterator per SSTable
  - Use a min-heap keyed by current (key, sequence_number)
  - Newest SSTable (highest sequence number) wins on duplicate keys
  - Tombstone with no later version is omitted from output (garbage collected)

Write Amplification monitoring:
  bytes_written_by_compaction / bytes_written_by_client
"""

from __future__ import annotations

import asyncio
import heapq
import logging
import time
from pathlib import Path
from typing import TYPE_CHECKING, Iterator, Optional

if TYPE_CHECKING:
    from storage.manifest import Manifest

from storage.sstable import SSTable, SSTableWriter
from storage.compaction_stats import CompactionStats

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# K-Way Merge Iterator
# ---------------------------------------------------------------------------


def _kway_merge(
    sstables: list[SSTable],
    stats: Optional[CompactionStats] = None,
):
    """
    Merge multiple sorted SSTable iterators.

    For duplicate keys, the entry from the highest-sequence SSTable wins.
    The merge emits one entry per unique key.

    Heap entry: (key, neg_sequence, value, expiry_ts, is_tombstone)
    neg_sequence ensures the highest sequence number is popped first
    when keys are equal.
    """
    if stats is None:
        # Used by unit tests that call _kway_merge() directly.
        stats = CompactionStats()

    # One Record iterator per SSTable, paired with its sequence number
    iterators = []
    for sst in sorted(sstables, key=lambda s: s.sequence):
        iterators.append((sst.sequence, sst.scan_records()))

    # Initialise heap with first entry from each iterator
    heap: list = []
    for seq, it in iterators:
        try:
            record = next(it)

            heapq.heappush(
                heap,
                (
                    record.key,
                    -seq,
                    record,
                    seq,
                    it,
                ),
            )

        except StopIteration:
            pass

    while heap:
        key, neg_seq, record, seq, it = heapq.heappop(heap)

        # Drain all duplicates for the same key, keeping the newest
        winner = record
        winner_seq = seq

        while heap and heap[0][0] == key:
            dup_key, dup_neg_seq, dup_record, dup_seq, dup_it = (
                heapq.heappop(heap)
            )
            stats.obsolete_records += 1
            # Prefer higher record version.
            if dup_record.version > winner.version:
                winner = dup_record
                winner_seq = dup_seq

            # Same version → newest timestamp wins.
            elif (
                dup_record.version == winner.version
                and dup_record.timestamp > winner.timestamp
            ):
                winner = dup_record
                winner_seq = dup_seq

            # Same version & timestamp → newest SSTable wins.
            elif (
                dup_record.version == winner.version
                and dup_record.timestamp == winner.timestamp
                and dup_seq > winner_seq
            ):
                winner = dup_record
                winner_seq = dup_seq
            # Advance the duplicate's iterator
            try:
                next_record = next(dup_it)

                heapq.heappush(
                    heap,
                    (
                        next_record.key,
                        -dup_seq,
                        next_record,
                        dup_seq,
                        dup_it,
                    ),
                )
            except StopIteration:
                pass

        # Advance winner's iterator
        try:
            next_record = next(it)

            heapq.heappush(
                heap,
                (
                    next_record.key,
                    -seq,
                    next_record,
                    seq,
                    it,
                ),
            )
        except StopIteration:
            pass

        # Skip tombstones that have no surviving newer value (winner_tomb is the
        # verdict — no later entry contradicted it, so the key is truly deleted).
        # Tombstones are only dropped during compaction — they must remain during
        # flush so older SSTables don't ghost-resurrect deleted keys.
        if winner.tombstone:
            stats.tombstones_removed += 1
            continue

        # Skip expired entries
        if winner.is_expired(time.time()):
            stats.expired_removed += 1
            continue

        yield winner


# ---------------------------------------------------------------------------
# Compaction Engine
# ---------------------------------------------------------------------------


class CompactionEngine:
    """
    Background compaction task.

    Call `start()` to launch the asyncio task.
    Call `stop()` to cancel it cleanly.
    """

    def __init__(
        self,
        sstable_dir: str | Path,
        l0_trigger: int = 4,
        interval_seconds: float = 30.0,
    ):
        self._dir = Path(sstable_dir)
        self._dir.mkdir(parents=True, exist_ok=True)
        self._l0_trigger = l0_trigger
        self._interval = interval_seconds
        self._task: Optional[asyncio.Task] = None
        self._stats = CompactionStats()

        # Metrics
        self.total_bytes_compacted: int = 0
        self.compaction_runs: int = 0
        self.last_run_duration_ms: float = 0.0

    # ------------------------------------------------------------------
    # Public API used by StorageEngine
    # ------------------------------------------------------------------

    def set_sstable_registry(self, registry: "SSTableRegistry") -> None:
        """Inject reference to the shared SSTable registry."""
        self._registry = registry

    def set_manifest(self, manifest: "Manifest") -> None:
        """Inject reference to the shared MANIFEST."""
        self._manifest = manifest

    def start(self) -> asyncio.Task:
        self._task = asyncio.create_task(self._loop(), name="compaction")
        return self._task

    def stop(self) -> None:
        if self._task:
            self._task.cancel()

    # ------------------------------------------------------------------
    # Background loop
    # ------------------------------------------------------------------

    async def _loop(self) -> None:
        while True:
            await asyncio.sleep(self._interval)
            try:
                await asyncio.to_thread(self._run_if_needed)
            except Exception as exc:
                log.error("Compaction error: %s", exc, exc_info=True)

    def _run_if_needed(self) -> None:
        l0 = self._registry.get_level(0)
        if len(l0) >= self._l0_trigger:
            log.info("Compacting %d L0 SSTables", len(l0))
            self._compact_level(0, l0)

        l1 = self._registry.get_level(1)
        if len(l1) >= self._l0_trigger * 2:
            log.info("Compacting %d L1 SSTables", len(l1))
            self._compact_level(1, l1)

    def _compact_level(self, level: int, sstables: list[SSTable]) -> None:
        if not sstables:
            return

        t0 = time.perf_counter()
        self._stats.reset()

        self._stats.input_tables = len(sstables)
        self._stats.bytes_in = sum(
            s.size_bytes()
            for s in sstables
        )

        self._stats.input_records = sum(
            s.entry_count
            for s in sstables
        )

        new_seq = self._registry.next_sequence()
        out_path = self._dir / f"sst_{new_seq:07d}.dat"

        writer = SSTableWriter(
            out_path, bloom_capacity=sum(s.entry_count for s in sstables)
        )
        new_sst = writer.write(
            _kway_merge(
                sstables,
                self._stats,
            )
        )

        if new_sst is not None:
            if hasattr(self, "_manifest"):
                self._manifest.add_sstable(out_path, level=level + 1)
                for sst in sstables:
                    self._manifest.remove_sstable(sst.path)
                self._manifest.save()
            self._registry.add(new_sst, level=level + 1)

        for sst in sstables:
            self._registry.remove(sst)

        for sst in sstables:
            sst.delete_file()

        self._stats.duration_ms = (
            time.perf_counter() - t0
        ) * 1000

        elapsed_ms = self._stats.duration_ms
        self.total_bytes_compacted += self._stats.bytes_in
        self.compaction_runs += 1
        self.last_run_duration_ms = elapsed_ms

        bytes_out = new_sst.size_bytes() if new_sst else 0
        self._stats.output_tables = (
            1 if new_sst else 0
        )

        self._stats.bytes_out = bytes_out

        self._stats.output_records = (
            new_sst.entry_count
            if new_sst
            else 0
        )
        log.info(
            "Compaction done: level=%d in=%d out=%d ratio=%.2f time=%.1fms",
            level,
            self._stats.bytes_in,
            bytes_out,
            self._stats.bytes_in / max(self._stats.bytes_out, 1),
            elapsed_ms,
        )


# ---------------------------------------------------------------------------
# SSTable Registry (shared mutable state between Engine and Compaction)
# ---------------------------------------------------------------------------


class SSTableRegistry:
    """
    Thread-safe (asyncio + threading) registry of all live SSTables.

    SSTables are stored in two levels:
      level 0: freshly flushed (uncompacted)
      level 1+: compacted outputs
    """

    def __init__(self) -> None:
        import threading

        self._lock = threading.Lock()
        self._levels: dict[int, list[SSTable]] = {0: [], 1: [], 2: []}
        self._seq: int = 0

    def next_sequence(self) -> int:
        with self._lock:
            self._seq += 1
            return self._seq

    def add(self, sst: SSTable, level: int = 0) -> None:
        with self._lock:
            self._levels.setdefault(level, []).append(sst)
            if sst.sequence > self._seq:
                self._seq = sst.sequence

    def remove(self, sst: SSTable) -> None:
        with self._lock:
            for level_list in self._levels.values():
                try:
                    level_list.remove(sst)
                except ValueError:
                    pass

    def get_level(self, level: int) -> list[SSTable]:
        with self._lock:
            return list(self._levels.get(level, []))

    def all_sstables_newest_first(self) -> list[SSTable]:
        """Return all SSTables ordered newest→oldest for read path."""
        with self._lock:
            result = []
            for level in self._levels.values():
                result.extend(level)
            return sorted(
                result,
                key=lambda s: s.sequence,
                reverse=True,
            )

    def total_count(self) -> int:
        with self._lock:
            return sum(len(v) for v in self._levels.values())

    def count_per_level(self) -> dict[int, int]:
        with self._lock:
            return {k: len(v) for k, v in self._levels.items()}

    def load_from_disk(self, sstable_dir: Path) -> None:
        """On startup, discover and load all existing SSTable files."""
        with self._lock:
            files = sorted(sstable_dir.glob("sst_*.dat"))
            for f in files:
                sst = SSTable(f)
                try:
                    sst.load()
                    self._levels[0].append(sst)
                    if sst.sequence > self._seq:
                        self._seq = sst.sequence
                except Exception as exc:
                    log.warning("Skipping corrupt SSTable %s: %s", f, exc)

    def load_from_manifest(
        self, sstable_dir: Path, manifest_entries: list[dict[str, int]]
    ) -> None:
        """Load only SSTables listed in the MANIFEST."""
        with self._lock:
            for entry in manifest_entries:
                path = sstable_dir / entry["path"]
                sst = SSTable(path)
                try:
                    sst.load()
                    self._levels.setdefault(entry["level"], []).append(sst)
                    if sst.sequence > self._seq:
                        self._seq = sst.sequence
                except Exception as exc:
                    log.warning("Skipping corrupt SSTable %s: %s", path, exc)
