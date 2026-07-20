"""
Write-Ahead Log (WAL) — Phase 1 durability layer.

Every write is appended to wal.log *before* ACK is sent to the client.
On startup, replay() restores the full MemTable state from WAL.
After a successful SSTable flush, truncate() discards flushed entries.

Wire format per entry:
  [4 bytes big-endian length][msgpack-encoded dict]

Entry dict keys:
  ts  : float  — unix timestamp of the write
  op  : str    — "SET" | "DEL"
  key : str    — the key
  val : bytes  — the value (b"" for DEL)
  ttl : float  — optional, seconds from ts (only present when SET with TTL)
"""

from __future__ import annotations

import os
import struct
import time
from pathlib import Path
from typing import Iterator
from storage.record import Record

import msgpack

_LENGTH_FMT = ">I"  # 4-byte big-endian unsigned int
_LENGTH_SIZE = struct.calcsize(_LENGTH_FMT)


class WAL:
    """
    Append-only write-ahead log.

    Thread safety: designed for a single asyncio event loop — no locking.
    """

    def __init__(self, path: str | Path):
        self._path = Path(path)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._fh = open(self._path, "ab")

    # ------------------------------------------------------------------
    # Append
    # ------------------------------------------------------------------

    def _write_entry(self, entry: dict) -> None:
        """
        Serialize and durably append one WAL entry.
        """

        data = msgpack.packb(entry, use_bin_type=True)

        self._fh.write(struct.pack(_LENGTH_FMT, len(data)))
        self._fh.write(data)
        self._fh.flush()
        os.fsync(self._fh.fileno())
    
    def append(
        self,
        op: str,
        key: str,
        value: bytes = b"",
        ttl: float | None = None,
        version: int = 1,
        expiry: float | None = None,
        tombstone: bool = False,
    ) -> None:
        """
        Durably append one operation to the log.
        flush() is called on every write to guarantee persistence.
        """
        entry: dict = {
            "ts": time.time(),
            "op": op,
            "key": key,
            "val": value,
            "version": version,
            "expiry": expiry,
            "tombstone": tombstone,
        }
        if ttl is not None:
            entry["ttl"] = ttl
        self._write_entry(entry)

    def append_record(self, record: Record) -> None:
        """
        Append an existing Record to the WAL while preserving
        version, timestamp, expiry and tombstone.
        """

        entry = {
            "ts": record.timestamp,
            "op": "DEL" if record.tombstone else "SET",
            "key": record.key,
            "val": record.value,
            "version": record.version,
            "expiry": record.expiry,
            "tombstone": record.tombstone,
        }

        self._write_entry(entry)

    # ------------------------------------------------------------------
    # Replay
    # ------------------------------------------------------------------

    def replay(self) -> Iterator[dict]:
        """
        Yield all valid log entries in order.

        Partial entries at the tail (e.g. from a mid-write crash) are
        silently discarded — the incomplete write never reached the client.
        """
        if not self._path.exists() or self._path.stat().st_size == 0:
            return

        with open(self._path, "rb") as f:
            while True:
                header = f.read(_LENGTH_SIZE)
                if len(header) < _LENGTH_SIZE:
                    break  # EOF
                (length,) = struct.unpack(_LENGTH_FMT, header)
                data = f.read(length)
                if len(data) < length:
                    break  # truncated entry — discard
                try:
                    yield msgpack.unpackb(data, raw=False)
                except Exception:
                    break  # corrupt entry — stop replay here


    def replay_records(self) -> Iterator[Record]:
        """
        Yield Record objects from the WAL.
        """

        for entry in self.replay():
            yield Record.from_wal_dict(entry)

    # ------------------------------------------------------------------
    # Truncate (after SSTable flush)
    # ------------------------------------------------------------------

    def truncate(self) -> None:
        """
        Atomically clear the WAL after MemTable data is safely on disk.
        The old file handle is closed and reopened in write mode.
        """
        self._fh.close()
        with open(self._path, "wb"):
            pass  # truncate to zero bytes
        self._fh = open(self._path, "ab")

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def close(self) -> None:
        self._fh.flush()
        self._fh.close()

    @property
    def path(self) -> Path:
        return self._path

    @property
    def size_bytes(self) -> int:
        return self._path.stat().st_size if self._path.exists() else 0
