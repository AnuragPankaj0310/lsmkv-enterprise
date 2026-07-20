import pytest

from distributed.replica_sync_coordinator import ReplicaSyncCoordinator
from distributed.replica_sync_executor import ReplicaSyncExecutor
from storage.record import Record


class FakeClient:
    def __init__(self):
        self.calls = []

    async def _repair_replica(self, addr, key, record):
        self.calls.append((addr, key, record.version))


@pytest.mark.asyncio
async def test_coordinator_detects_and_repairs():
    executor = ReplicaSyncExecutor(FakeClient())
    coordinator = ReplicaSyncCoordinator(executor)

    source = {
        "user": Record(
            key="user",
            value=b"alice",
            version=4,
            timestamp=4.0,
        )
    }

    destination = {
        "user": Record(
            key="user",
            value=b"old",
            version=2,
            timestamp=2.0,
        )
    }

    repaired = await coordinator.synchronize(
        source,
        destination,
        "node2",
    )

    assert repaired == 1