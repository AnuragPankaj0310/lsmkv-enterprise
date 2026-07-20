from __future__ import annotations

import asyncio

from client.sdk import LsmkvClient
from distributed.replica_sync import ReplicaDifference


class ReplicaSyncExecutor:
    """
    Executes a synchronization plan by sending REPLICA_SET
    commands to stale replicas.
    """

    def __init__(self, client: LsmkvClient):
        self._client = client

    async def synchronize(
        self,
        destination: str,
        repairs: list[ReplicaDifference],
    ) -> int:
        """
        Apply all repairs to one destination replica.

        Returns the number of repaired records.
        """

        repaired = 0

        for repair in repairs:
            await self._client._repair_replica(
                destination,
                repair.key,
                repair.source,
            )
            repaired += 1

        return repaired