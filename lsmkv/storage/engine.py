"""
StorageEngine — Unified storage API (Phase 1–4).

Coordinates all storage components:
  MemTable → WAL → SSTable flush → Compaction

Write path:
  SET key value
    1. Append to WAL (durable)
    2. Insert into MemTable (fast)
    3. If MemTable.is_full() → flush to SSTable → truncate WAL

Read path:
  GET key
    1. Check MemTable (newest data, O(log n))
    2. Check SSTables newest→oldest:
       a. Bloom filter (skip if key definitely absent — no disk I/O)
       b. Sparse index binary search → seek → scan

Recovery (startup):
  1. Load all SSTable files from disk
  2. Replay WAL → re-populate MemTable
  3. Start background TTL sweep and compaction tasks

Storage Engine Metrics tracked here:
  - write_amplification
  - read_amplification
  - bloom_filter_hit_rate
  - sstable_count
  - compaction_throughput
"""

from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path
import time
from typing import Optional

from storage.compaction import CompactionEngine, SSTableRegistry
from storage.manifest import Manifest
from storage.memtable import MemTable
from storage.sstable import SSTableWriter
from storage.wal import WAL
from storage.version import VersionManager
from storage.record import Record
from storage.cache import LRUCache
from storage.snapshot import SnapshotManager

log = logging.getLogger(__name__)


class StorageEngine:
    """
    Public API for the storage layer.

    All methods are safe to call from a single asyncio event loop.
    Flush and compaction are run in thread pool executors to avoid
    blocking the event loop during I/O.
    """

    def __init__(
        self,
        data_dir: str | Path = "data",
        memtable_size_bytes: int = 4 * 1024 * 1024,
        l0_compaction_trigger: int = 4,
        compaction_interval: float = 30.0,
        ttl_sweep_interval: float = 10.0,
    ):
        self._data_dir = Path(data_dir)
        self._sst_dir = self._data_dir / "sstables"
        self._wal_path = self._data_dir / "wal.log"
        self._manifest_path = self._sst_dir / "MANIFEST.json"
        self._sst_dir.mkdir(parents=True, exist_ok=True)

        self._memtable = MemTable(max_size_bytes=memtable_size_bytes)
        self._cache = LRUCache(capacity=10000)
        self._wal = WAL(self._wal_path)
        self._versions = VersionManager()
        self._manifest = Manifest(self._manifest_path)
        self._snapshots = SnapshotManager(self._data_dir)

        self._registry = SSTableRegistry()
        self._compaction = CompactionEngine(
            self._sst_dir, l0_compaction_trigger, compaction_interval
        )
        self._compaction.set_sstable_registry(self._registry)
        self._compaction.set_manifest(self._manifest)

        self._flushing = False  # guard against concurrent flushes
        self._ttl_sweep_interval = ttl_sweep_interval
        self._closed = False

        # Background tasks
        self._ttl_task: asyncio.Task | None = None

        # Metric counters
        self._client_bytes_written: int = 0
        self._disk_bytes_written: int = 0
        self._total_reads: int = 0
        self._bloom_skips: int = 0  # SSTables skipped by Bloom filter
        self._sstable_reads: int = 0  # SSTables actually read

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def open(self) -> None:
        """Load SSTables from disk, replay WAL, start background tasks."""
        # 1. Load manifest → discover active SSTables
        self._manifest.load()
        await asyncio.to_thread(
            self._registry.load_from_manifest,
            self._sst_dir,
            self._manifest.active_sstables(),
        )
        log.info("Loaded %d SSTables from MANIFEST", self._registry.total_count())

        # 2. Replay WAL → restore MemTable
        entries_replayed = 0

        for record in self._wal.replay_records():
            self._versions.observe(record.version)
            self._apply_record(record)

            entries_replayed += 1

        log.info("Replayed %d WAL entries", entries_replayed)

        # 3. Start background tasks
        self._compaction.start()
        self._ttl_task = asyncio.create_task(
            self._ttl_sweep_loop(),
            name="ttl_sweep",
        )

    async def close(self) -> None:
        """Flush any remaining MemTable data and close WAL."""
        if self._closed:
            return

        self._closed = True

        # Stop background tasks
        if self._ttl_task is not None:
            self._ttl_task.cancel()
            try:
                await self._ttl_task
            except asyncio.CancelledError:
                pass

        self._compaction.stop()

        if len(self._memtable) > 0:
            await self._flush_memtable()

        self._cache.clear()
        self._wal.close()

    # ------------------------------------------------------------------
    # Write path
    # ------------------------------------------------------------------


    def _create_record(
        self,
        key: str,
        value: bytes,
        ttl: Optional[float] = None,
        tombstone: bool = False,
    ) -> Record:
        """
        Create a fully-populated Record with
        version, timestamp and expiry.
        """
        timestamp = time.time()
        version = self._versions.next()

        expiry = (
            timestamp + ttl
            if ttl is not None
            else None
        )

        return Record(
            key=key,
            value=value,
            version=version,
            timestamp=timestamp,
            expiry=expiry,
            tombstone=tombstone,
        )


    def _apply_record(
        self,
        record: Record,
    ) -> None:
        """
        Apply a Record to the MemTable.
        """

        ttl = None

        if record.expiry is not None:
            ttl = max(0.0, record.expiry - record.timestamp)

        if record.tombstone:
            self._memtable.delete(
                record.key,
                version=record.version,
                timestamp=record.timestamp,
            )
        else:
            self._memtable.set(
                record.key,
                record.value,
                ttl,
                version=record.version,
                timestamp=record.timestamp,
            )


    async def repair_set(
        self,
        record: Record,
    ) -> None:
        """
        Apply an existing replicated Record.

        Unlike set(), this preserves:
            - version
            - timestamp
            - expiry
            - tombstone

        Used by:
            - Read Repair
            - Replica Synchronization
            - Hinted Handoff
        """

        self._wal.append_record(record)

        self._apply_record(record)

        if self._memtable.is_full() and not self._flushing:
            await self._flush_memtable()


    async def set(self, key: str, value: bytes, ttl: Optional[float] = None) -> None:
        """
        SET key → value.
        1. WAL append (durable)
        2. MemTable insert
        3. Flush if full
        """
        record = self._create_record(
            key,
            value,
            ttl,
        )
        self._wal.append(
            "SET",
            record.key,
            record.value,
            ttl,
            version=record.version,
            expiry=record.expiry,
        )
        self._apply_record(record)
        self._cache.put(record.key, record.value)
        self._client_bytes_written += len(key.encode()) + len(value)

        if self._memtable.is_full() and not self._flushing:
            await self._flush_memtable()

    async def delete(self, key: str) -> None:
        """DEL key → tombstone marker."""
        record = self._create_record(
            key,
            b"",
            tombstone=True,
        )
        self._wal.append(
            "DEL",
            record.key,
            version=record.version,
            tombstone=True,
        )
        self._apply_record(record)
        self._cache.remove(record.key)
        if self._memtable.is_full() and not self._flushing:
            await self._flush_memtable()

    # ------------------------------------------------------------------
    # Read path
    # ------------------------------------------------------------------

    async def get_record(
        self,
        key: str,
    ) -> Optional[Record]:
        """
        Return the newest Record for a key.
        """

        # Check MemTable first
        record = self._memtable.get_record(key)

        if record is not None:
            return record

        # Search SSTables from newest to oldest
        for table in self._registry.all_sstables_newest_first():

            record = await asyncio.to_thread(
                table.get_record,
                key,
            )

            if record is not None:
                return record

        return None

    async def get(self, key: str) -> Optional[bytes]:
        """
        GET key.
        1. MemTable (O(log n), no I/O)
        2. SSTables newest→oldest with Bloom filter guard
        """
        self._total_reads += 1

        cached = self._cache.get(key)

        if cached is not None:
            return cached

        # Step 1 — MemTable
        val = self._memtable.get(key)

        if val is not None:
            self._cache.put(key, val)
            return val
        if self._memtable.is_tombstone(key):
            return None  # deleted

        # Step 2 — SSTables
        sstables = self._registry.all_sstables_newest_first()
        for sst in sstables:
            if not sst.might_contain(key):
                self._bloom_skips += 1
                continue  # Bloom says definitely not here
            self._sstable_reads += 1
            result = await asyncio.to_thread(
                sst.get,
                key,
            )

            if result is not None:
                self._cache.put(key, result)
                return result

        return None

    # ------------------------------------------------------------------
    # Flush
    # ------------------------------------------------------------------

    async def _flush_memtable(self) -> None:
        """Flush MemTable to a new SSTable file, then truncate WAL."""
        self._flushing = True
        try:
            seq = self._registry.next_sequence()
            path = self._sst_dir / f"sst_{seq:07d}.dat"
            records = list(self._memtable.records())

            count = len(records)
            if count == 0:
                return

            writer = SSTableWriter(path, bloom_capacity=count)
            new_sst = await asyncio.to_thread(
                writer.write,
                iter(records),
            )

            if new_sst is not None:
                disk_bytes = new_sst.size_bytes()
                self._disk_bytes_written += disk_bytes
                self._manifest.add_sstable(path, level=0)
                self._manifest.save()
                self._registry.add(new_sst, level=0)
                log.info(
                    "Flushed MemTable → %s (%d entries, %d bytes)",
                    path.name,
                    count,
                    disk_bytes,
                )

            self._memtable.clear()
            self._wal.truncate()
        finally:
            self._flushing = False

    # ------------------------------------------------------------------
    # Background TTL sweep
    # ------------------------------------------------------------------

    async def _ttl_sweep_loop(self) -> None:
        while not self._closed:
            await asyncio.sleep(self._ttl_sweep_interval)
            removed = self._memtable.sweep_expired()
            if removed:
                log.debug("TTL sweep removed %d entries", removed)

    # ------------------------------------------------------------------
    # Storage Engine Metrics
    # ------------------------------------------------------------------

    @property
    def write_amplification(self) -> float:
        """Bytes written to disk / bytes written by client."""
        if self._client_bytes_written == 0:
            return 0.0
        return self._disk_bytes_written / self._client_bytes_written

    @property
    def read_amplification(self) -> float:
        """Average SSTables read per logical GET (lower = better)."""
        if self._total_reads == 0:
            return 0.0
        return self._sstable_reads / self._total_reads

    @property
    def bloom_filter_hit_rate(self) -> float:
        """Fraction of SSTable lookups eliminated by Bloom filter."""
        total_checks = self._bloom_skips + self._sstable_reads
        if total_checks == 0:
            return 0.0
        return self._bloom_skips / total_checks

    @property
    def sstable_count(self) -> int:
        return self._registry.total_count()

    @property
    def sstable_count_per_level(self) -> dict[int, int]:
        return self._registry.count_per_level()

    @property
    def compaction_throughput_bytes_sec(self) -> float:
        """Bytes compacted per second (based on last run duration)."""
        dur = self._compaction.last_run_duration_ms / 1000.0
        if dur == 0:
            return 0.0
        return self._compaction.total_bytes_compacted / dur

    @property
    def disk_usage_bytes(self):
        total = 0
        for path in Path(self._data_dir).rglob("*"):
            if path.is_file():
                total += path.stat().st_size
        return total

    def metrics_snapshot(self) -> dict:
        return {
            "write_amplification": round(self.write_amplification, 3),
            "read_amplification": round(self.read_amplification, 3),
            "bloom_filter_hit_rate": round(self.bloom_filter_hit_rate, 3),
            "sstable_count": self.sstable_count,
            "sstable_count_per_level": {
                str(level): count
                for level, count in self.sstable_count_per_level.items()
            },
            "compaction_throughput_bytes_sec": round(
                self.compaction_throughput_bytes_sec, 1
            ),
            "compaction_runs": self._compaction.compaction_runs,
            "memtable_size_bytes": self._memtable.size_bytes(),
            "memtable_entries": len(self._memtable),
            "disk_usage_bytes": self.disk_usage_bytes,
            # Raw counters for Prometheus delta tracking
            "bloom_skips_count": self._bloom_skips,
            "cache_hits": self._cache.hits,
            "cache_misses": self._cache.misses,
            "cache_hit_rate": round(self._cache.hit_rate, 3),
            "cache_evictions": self._cache.evictions,
            "cache_entries": self._cache.size,
        }
    
    async def metrics_snapshot_async(self):
        """
        Metrics requiring async operations.
        """
        snapshot = self.metrics_snapshot()

        keys = await self.all_keys()

        snapshot["total_keys"] = len(keys)
        snapshot["disk_usage_bytes"] = self.disk_usage_bytes
        return snapshot

    async def all_keys(self) -> list[str]:
        """
        Return every live key known to this storage engine.
        """

        keys = set()

        # MemTable
        for key, *_ in self._memtable.items():
            keys.add(key)

        # SSTables
        for table in self._registry.all_sstables_newest_first():
            for key, *_ in table.scan():
                keys.add(key)

        return sorted(keys)


    # ------------------------------------------------------------------
    # Snapshots
    # ------------------------------------------------------------------

    async def snapshot_create(self, name: str) -> None:
        """
        Flush pending writes and create a point-in-time snapshot.
        """

        if len(self._memtable) > 0:
            await self._flush_memtable()

        await asyncio.to_thread(
            self._snapshots.create,
            name,
        )

    async def snapshot_list(self) -> list[str]:
        return await asyncio.to_thread(
            self._snapshots.list
        )
    
    async def snapshot_info(
        self,
        name: str,
    ) -> dict:
        """
        Return metadata for a snapshot.
        """
        return await asyncio.to_thread(
            self._snapshots.info,
            name,
        )
    
    async def snapshot_delete(
        self,
        name: str,
    ) -> None:
        """
        Delete a snapshot.
        """
        await asyncio.to_thread(
            self._snapshots.delete,
            name,
        )
    
    async def snapshot_restore(self, name: str) -> None:
        """
        Restore a snapshot.

        The storage engine must be closed before restoring.
        """

        if not self._closed:
            raise RuntimeError(
                "Close the storage engine before restoring a snapshot."
            )

        await asyncio.to_thread(
            self._snapshots.restore,
            name,
        )

    # ------------------------------------------------------------------
    # Factory from config
    # ------------------------------------------------------------------

    @classmethod
    def from_config(cls, config_path: str | Path = "config.json") -> "StorageEngine":
        with open(config_path) as f:
            cfg = json.load(f)
        return cls(
            data_dir=cfg.get("sstable_dir", "data/sstables").rsplit("/", 1)[0],
            memtable_size_bytes=cfg.get("memtable_size_bytes", 4 * 1024 * 1024),
            l0_compaction_trigger=cfg.get("l0_compaction_trigger", 4),
            compaction_interval=cfg.get("compaction_interval_seconds", 30.0),
            ttl_sweep_interval=cfg.get("ttl_sweep_interval_seconds", 10.0),
        )
