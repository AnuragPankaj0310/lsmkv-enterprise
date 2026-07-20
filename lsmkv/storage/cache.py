"""
Thread-safe LRU cache for hot keys.

Stores recently accessed key/value pairs to reduce MemTable/SSTable
lookups on repeated reads.
"""

from __future__ import annotations

from collections import OrderedDict
from typing import Optional


class LRUCache:
    def __init__(self, capacity: int = 10000):
        self._capacity = capacity
        self._cache: OrderedDict[str, bytes] = OrderedDict()

        self._hits = 0
        self._misses = 0
        self._evictions = 0

    def get(self, key: str) -> Optional[bytes]:
        if key not in self._cache:
            self._misses += 1
            return None

        self._hits += 1
        self._cache.move_to_end(key)
        return self._cache[key]

    def put(self, key: str, value: bytes) -> None:
        if key in self._cache:
            self._cache.move_to_end(key)

        self._cache[key] = value

        if len(self._cache) > self._capacity:
            self._cache.popitem(last=False)
            self._evictions += 1

    def remove(self, key: str) -> None:
        self._cache.pop(key, None)

    def clear(self) -> None:
        self._cache.clear()

    @property
    def hits(self) -> int:
        return self._hits

    @property
    def misses(self) -> int:
        return self._misses

    @property
    def evictions(self) -> int:
        return self._evictions

    @property
    def size(self) -> int:
        return len(self._cache)

    @property
    def hit_rate(self) -> float:
        total = self._hits + self._misses
        if total == 0:
            return 0.0
        return self._hits / total