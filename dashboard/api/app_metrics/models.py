"""
dashboard/api/metrics/models.py

Lightweight dataclass for a single recorded operation.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(slots=True)
class OpRecord:
    """One observed key-value operation."""
    ts: float          # monotonic timestamp (time.monotonic())
    wall_ts: float     # wall-clock timestamp (time.time()) for display
    cmd: str           # "SET" | "GET" | "DEL"
    latency_ms: float  # round-trip time in milliseconds
    ok: bool           # True = success, False = error
    node: str          # target node addr, e.g. "node0:7001"
