import pytest

from distributed.replica_sync import ReplicaDifference
from distributed.replica_sync_executor import ReplicaSyncExecutor
from storage.record import Record


class FakeClient:
    def __init__(self):
        self.calls = []

    async def _repair_replica(self, addr, key, record):
        self.calls.append((addr, key, record.version))


@pytest.mark.asyncio
async def test_executor_repairs_all_records():
    client = FakeClient()

    executor = ReplicaSyncExecutor(client)

    repairs = [
        ReplicaDifference(
            key="a",
            source=Record(
                key="a",
                value=b"1",
                version=2,
                timestamp=2.0,
            ),
            destination=None,
        ),
        ReplicaDifference(
            key="b",
            source=Record(
                key="b",
                value=b"2",
                version=3,
                timestamp=3.0,
            ),
            destination=None,
        ),
    ]

    repaired = await executor.synchronize(
        "node2",
        repairs,
    )

    assert repaired == 2
    assert len(client.calls) == 2