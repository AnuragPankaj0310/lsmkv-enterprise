from storage.record import Record
from storage.wal import WAL


def test_append_record_preserves_version(tmp_path):
    wal = WAL(tmp_path / "wal.log")

    record = Record(
        key="user",
        value=b"alice",
        version=42,
        timestamp=123.45,
    )

    wal.append_record(record)

    restored = next(wal.replay_records())

    assert restored.version == 42
    assert restored.timestamp == 123.45
    assert restored.key == "user"