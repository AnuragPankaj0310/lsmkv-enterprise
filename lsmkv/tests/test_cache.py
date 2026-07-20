from storage.cache import LRUCache


def test_put_get():
    cache = LRUCache(2)

    cache.put("a", b"1")

    assert cache.get("a") == b"1"


def test_cache_miss():
    cache = LRUCache()

    assert cache.get("missing") is None


def test_lru_eviction():
    cache = LRUCache(2)

    cache.put("a", b"1")
    cache.put("b", b"2")

    cache.get("a")

    cache.put("c", b"3")

    assert cache.get("b") is None
    assert cache.get("a") == b"1"
    assert cache.get("c") == b"3"


def test_remove():
    cache = LRUCache()

    cache.put("x", b"1")
    cache.remove("x")

    assert cache.get("x") is None


def test_clear():
    cache = LRUCache()

    cache.put("a", b"1")
    cache.put("b", b"2")

    cache.clear()

    assert cache.size == 0


def test_hit_rate():
    cache = LRUCache()

    cache.put("a", b"1")

    cache.get("a")
    cache.get("missing")

    assert cache.hits == 1
    assert cache.misses == 1
    assert cache.hit_rate == 0.5


def test_eviction_counter():
    cache = LRUCache(1)

    cache.put("a", b"1")
    cache.put("b", b"2")

    assert cache.evictions == 1