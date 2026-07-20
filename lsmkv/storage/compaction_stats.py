"""
Compaction statistics.

Collects metrics describing the effectiveness and cost of each
compaction run.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(slots=True)
class CompactionStats:
    input_tables: int = 0
    output_tables: int = 0

    input_records: int = 0
    output_records: int = 0

    obsolete_records: int = 0
    tombstones_removed: int = 0
    expired_removed: int = 0

    bytes_in: int = 0
    bytes_out: int = 0

    duration_ms: float = 0.0

    def reset(self) -> None:
        self.input_tables = 0
        self.output_tables = 0

        self.input_records = 0
        self.output_records = 0

        self.obsolete_records = 0
        self.tombstones_removed = 0
        self.expired_removed = 0

        self.bytes_in = 0
        self.bytes_out = 0

        self.duration_ms = 0.0