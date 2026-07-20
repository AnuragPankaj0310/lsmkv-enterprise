"""
Canonical representation of a key-value record.

All storage layers (MemTable, WAL, SSTable, Replication)
exchange Record objects instead of raw tuples.

Version 2.1 introduces record versioning to support:

- Replica reconciliation
- Read repair
- Snapshot recovery
- Hinted handoff
- Version-aware compaction
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from typing import TypeAlias

SSTableEntry: TypeAlias = list[object]
WALEntry: TypeAlias = dict[str, object]


@dataclass(slots=True)
class Record:
    """
    Represents one logical key/value entry.

    A tombstone is represented by:
        tombstone=True
        value=b""
    """

    key: str
    value: bytes
    version: int = 1
    timestamp: float = 0.0
    expiry: Optional[float] = None
    tombstone: bool = False

    # ------------------------------------------------------------------
    # State helpers
    # ------------------------------------------------------------------

    def is_expired(self, now: float) -> bool:
        """Return True if this record has expired."""
        return (
            self.expiry is not None
            and now > self.expiry
        )

    def is_live(self, now: float) -> bool:
        """Return True if the record is visible to readers."""
        return (
            not self.tombstone
            and not self.is_expired(now)
        )

    def is_deleted(self) -> bool:
        """Return True if this record is a tombstone."""
        return self.tombstone

    # ------------------------------------------------------------------
    # SSTable serialization
    # ------------------------------------------------------------------

    def to_sstable_entry(self) -> SSTableEntry:
        """
        Serialize into the SSTable on-disk format.
        """
        return [
            self.key,
            self.value,
            self.version,
            self.timestamp,
            self.expiry,
            self.tombstone,
        ]

    @classmethod
    def from_sstable_entry(cls, entry: list[object]) -> "Record":
        """
        Deserialize an SSTable entry.

        Supports both:

        Old format (v1):
            [key, value, expiry, tombstone]

        New format (v2.1):
            [key, value, version, timestamp, expiry, tombstone]
        """

        # New format
        if len(entry) == 6:
            (
                key,
                value,
                version,
                timestamp,
                expiry,
                tombstone,
            ) = entry

            return cls(
                key=key,
                value=bytes(value),
                version=version,
                timestamp=timestamp,
                expiry=expiry,
                tombstone=tombstone,
            )

        # Legacy format
        if len(entry) == 4:
            (
                key,
                value,
                expiry,
                tombstone,
            ) = entry

            return cls(
                key=key,
                value=bytes(value),
                version=1,
                timestamp=0.0,
                expiry=expiry,
                tombstone=tombstone,
            )

        raise ValueError(
            f"Unsupported SSTable entry format with {len(entry)} fields."
        )

    # ------------------------------------------------------------------
    # WAL serialization
    # ------------------------------------------------------------------

    def to_wal_dict(self, op: str) -> dict[str, object]:
        """
        Serialize into WAL format.
        """
        return {
            "ts": self.timestamp,
            "op": op,
            "key": self.key,
            "val": self.value,
            "version": self.version,
            "expiry": self.expiry,
            "tombstone": self.tombstone,
        }

    @classmethod
    def from_wal_dict(cls, entry: dict[str, object]) -> "Record":
        """
        Deserialize a WAL entry into a Record.
        """
        return cls(
            key=entry["key"],
            value=bytes(entry["val"]),
            version=entry.get("version", 1),
            timestamp=entry["ts"],
            expiry=entry.get("expiry"),
            tombstone=entry.get("tombstone", False),
        )

    # ------------------------------------------------------------------
    # Utilities
    # ------------------------------------------------------------------

    def copy(self) -> "Record":
        """
        Return a shallow copy of this record.
        """
        return Record(
            key=self.key,
            value=self.value,
            version=self.version,
            timestamp=self.timestamp,
            expiry=self.expiry,
            tombstone=self.tombstone,
        )