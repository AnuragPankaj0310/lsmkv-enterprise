import pytest

from storage.engine import StorageEngine
from storage.record import Record


@pytest.mark.asyncio
async def test_repair_set_preserves_version(tmp_path):
    engine = StorageEngine(data_dir=str(tmp_path))
    await engine.open()

    record = Record(
        key="user",
        value=b"alice",
        version=42,
        timestamp=123.45,
    )

    await engine.repair_set(record)

    restored = await engine.get_record("user")

    assert restored.version == 42
    assert restored.timestamp == 123.45

    await engine.close()