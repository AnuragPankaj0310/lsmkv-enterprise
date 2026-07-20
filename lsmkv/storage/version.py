"""
Monotonic version allocator.

Generates globally increasing logical version numbers for records.
Future distributed features (read repair, replica sync, hinted handoff)
will compare records using these versions.
"""

from __future__ import annotations


class VersionManager:
    """Simple monotonic logical version generator."""

    def __init__(self) -> None:
        self._next = 1

    def next(self) -> int:
        """Allocate the next version."""
        version = self._next
        self._next += 1
        return version

    def observe(self, version: int) -> None:
        """
        Observe an existing version (e.g. during WAL replay)
        so newly allocated versions remain strictly increasing.
        """
        if version >= self._next:
            self._next = version + 1

    @property
    def current(self) -> int:
        return self._next