from __future__ import annotations

from distributed.replica_sync import records_to_sync
from distributed.replica_sync_executor import ReplicaSyncExecutor


class ReplicaSyncCoordinator:
    """
    Coordinates replica synchronization.
    """

    def __init__(self, executor: ReplicaSyncExecutor):
        self._executor = executor

    async def synchronize(
        self,
        source_records,
        destination_records,
        destination_addr: str,
    ) -> int:
        """
        Compare replicas and synchronize stale records.

        Returns the number of repaired records.
        """

        repairs = records_to_sync(
            source_records,
            destination_records,
        )

        return await self._executor.synchronize(
            destination_addr,
            repairs,
        )