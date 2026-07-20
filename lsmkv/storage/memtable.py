"""
MemTable — In-memory sorted write buffer (Phase 1).

Keys stay sorted at all times via SortedDict so SSTable flush produces
a sorted file with zero additional sorting passes.

Each entry stores: (value: bytes, expiry_ts: float|None, is_tombstone: bool)
- value       : raw bytes payload
- expiry_ts   : unix timestamp after which key is considered expired (None = no TTL)
- is_tombstone: True when key has been DEL-eted (marker for compaction)

Size tracking is approximate (key bytes + value bytes + 32 byte overhead).
"""

from __future__ import annotations

import time
from typing import Iterator, Optional

from sortedcontainers import SortedDict
from storage.record import Record

_OVERHEAD = 32  # per-entry overhead estimate in bytes


class MemTable:
    """Single-writer, single-reader safe within one asyncio event loop."""

    def __init__(self, max_size_bytes: int = 4 * 1024 * 1024):
        self._data: SortedDict = SortedDict()  # key -> Record
        self._size: int = 0
        self._max_size: int = max_size_bytes

    # ------------------------------------------------------------------
    # Write API
    # ------------------------------------------------------------------

    def set(
        self,
        key: str,
        value: bytes,
        ttl: Optional[float] = None,
        version: int = 1,
        timestamp: Optional[float] = None,
    ) -> None:
        """Insert or update a key. ttl is seconds from now."""
        now = timestamp if timestamp is not None else time.time()

        expiry = now + ttl if ttl is not None else None

        record = Record(
            key=key,
            value=value,
            version=version,
            timestamp=now,
            expiry=expiry,
            tombstone=False,
        )

        self._replace(key, record)

    def set_record(self, record: Record) -> None:
        """
        Insert an existing Record into the MemTable without
        creating a new version or timestamp.

        Used by:
        - Read Repair
        - Replica Synchronization
        - Hinted Handoff
        """

        self._data[record.key] = record

    def delete(
        self,
        key: str,
        version: int = 1,
        timestamp: Optional[float] = None,
    ) -> None:
        """Mark key as deleted via tombstone."""
        now = timestamp if timestamp is not None else time.time()
        record = Record(
            key=key,
            value=b"",
            version=version,
            timestamp=now,
            expiry=None,
            tombstone=True,
        )

        self._replace(key, record)

    def _replace(self, key: str, record: Record) -> None:
        old = self._data.get(key)
        if old is not None:
            self._size -= _entry_size(key, old)
        self._data[key] = record
        self._size += _entry_size(key, record)

    # ------------------------------------------------------------------
    # Read API
    # ------------------------------------------------------------------

    def get(self, key: str) -> Optional[bytes]:
        """
        Returns value bytes for key, or None if missing / tombstone / expired.
        """
        record = self._data.get(key)

        if record is None:
            return None

        if record.tombstone:
            return None

        if record.expiry is not None and time.time() > record.expiry:
            return None

        return record.value

    def is_tombstone(self, key: str) -> bool:
        record = self._data.get(key)
        return record is not None and record.tombstone

    def contains(self, key: str) -> bool:
        return key in self._data
    
    def get_record(self, key: str) -> Optional[Record]:
        """
        Return the full Record for a key.

        Used by read repair, replica synchronization,
        and internal storage operations.
        """
        record = self._data.get(key)

        if record is None:
            return None

        if (
            not record.tombstone
            and record.expiry is not None
            and time.time() > record.expiry
        ):
            return None

        return record

    # ------------------------------------------------------------------
    # Flush support — yields all entries in sorted key order
    # ------------------------------------------------------------------

    def items(self):
        """
        Backward-compatible iterator.

        Used by existing code that expects the legacy tuple format.
        New internal code should use records().
        """
        for record in self.records():
            yield (
                record.key,
                record.value,
                record.expiry,
                record.tombstone,
            )

    def clear(self) -> None:
        """Called after successful flush to disk."""
        self._data.clear()
        self._size = 0


    def records(self) -> Iterator[Record]:
        """
        Yield Record objects in sorted key order.

        Internal storage API used by SSTable writing,
        compaction, replication, and recovery.
        """
        now = time.time()

        for record in self._data.values():
            if (
                not record.tombstone
                and record.expiry is not None
                and now > record.expiry
            ):
                continue

            yield record
    # ------------------------------------------------------------------
    # State
    # ------------------------------------------------------------------

    def is_full(self) -> bool:
        return self._size >= self._max_size

    def size_bytes(self) -> int:
        return self._size

    def __len__(self) -> int:
        return len(self._data)

    # ------------------------------------------------------------------
    # Background TTL sweep
    # ------------------------------------------------------------------

    def sweep_expired(self) -> int:
        """
        Remove expired non-tombstone entries from memory.
        Called periodically by an asyncio background task.
        Returns the number of entries removed.
        """
        now = time.time()

        expired_keys = [
            k
            for k, record in self._data.items()
            if (
                not record.tombstone
                and record.expiry is not None
                and now > record.expiry
            )
        ]

        for k in expired_keys:
            old = self._data.pop(k)
            self._size -= _entry_size(k, old)

        return len(expired_keys)


# ------------------------------------------------------------------
# Module-level helper (not a method — avoids repeated attribute lookups)
# ------------------------------------------------------------------


def _entry_size(key: str, record: Record) -> int:
    return (
        len(key.encode("utf-8"))
        + len(record.value)
        + _OVERHEAD
    )
