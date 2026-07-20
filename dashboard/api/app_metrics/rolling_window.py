"""
dashboard/api/metrics/rolling_window.py

A thread-safe, bounded deque that only exposes records within a
configurable time window.  All timestamps are monotonic so the window
is not affected by wall-clock adjustments.
"""
from __future__ import annotations

import threading
import time
from collections import deque
from typing import Sequence

from .models import OpRecord


class RollingWindow:
    """
    Fixed-capacity ring buffer that returns only records from the
    last ``window_seconds``.

    Thread-safe: a single ``threading.Lock`` guards all mutations.
    """

    def __init__(self, maxsize: int = 12_000, window_seconds: float = 60.0) -> None:
        self._maxsize = maxsize
        self._window = window_seconds
        self._buf: deque[OpRecord] = deque(maxlen=maxsize)
        self._lock = threading.Lock()

    def append(self, record: OpRecord) -> None:
        with self._lock:
            self._buf.append(record)

    def within(self, seconds: float | None = None) -> list[OpRecord]:
        """
        Return all records whose monotonic timestamp falls within the
        last ``seconds`` (defaults to the window configured at construction).
        """
        cutoff = time.monotonic() - (seconds if seconds is not None else self._window)
        with self._lock:
            return [r for r in self._buf if r.ts >= cutoff]

    def __len__(self) -> int:
        with self._lock:
            return len(self._buf)
