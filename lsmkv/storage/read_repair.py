"""
Utilities for replica reconciliation.

Phase 1 only detects stale replicas.
"""

from __future__ import annotations

from storage.record import Record


def newest_record(records: list[Record]) -> Record:
    """
    Return the newest record according to:

    1. version
    2. timestamp
    """

    return max(
        records,
        key=lambda r: (
            r.version,
            r.timestamp,
        ),
    )


def stale_records(records: list[Record]) -> list[Record]:
    """
    Return every replica that is older than the newest one.
    """

    newest = newest_record(records)

    return [
        r
        for r in records
        if (
            r.version,
            r.timestamp,
        )
        <
        (
            newest.version,
            newest.timestamp,
        )
    ]