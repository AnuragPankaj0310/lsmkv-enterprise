from storage.memtable import MemTable
from storage.record import Record


def test_set_record_preserves_version():
    mt = MemTable()

    record = Record(
        key="user",
        value=b"alice",
        version=42,
        timestamp=123.45,
    )

    mt.set_record(record)

    stored = mt.get_record("user")

    assert stored.version == 42
    assert stored.timestamp == 123.45
    assert stored.value == b"alice"