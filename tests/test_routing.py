import pytest
from distributed.ring import ConsistentHashRing
from distributed.routing import RequestRouter
from unittest.mock import AsyncMock, patch

@pytest.mark.asyncio
async def test_forward_request_marks_message():
    from network.server import LsmkvServer

    server = LsmkvServer(
        cluster_nodes=[
            "localhost:7001",
            "localhost:7002",
        ],
        node_address="localhost:7001",
    )

    msg = {
        "cmd": "SET",
        "key": "user1",
        "value": b"hello",
    }

    owner = server._router.primary(msg["key"])

    if owner == server._address:
        pytest.skip("Key mapped to local node; choose another key if needed.")

    with patch("network.server.send_request", new_callable=AsyncMock) as mock_send:
        mock_send.return_value = b"OK"

        result = await server._route_request(msg)

        assert result == b"OK"

        forwarded = mock_send.call_args.args[1]

        assert forwarded["forwarded"] is True
        assert forwarded["origin"] == server._address


def test_primary_owner():
    ring = ConsistentHashRing(
        [
            "node0",
            "node1",
            "node2",
        ]
    )

    router = RequestRouter(ring)

    owner = router.primary("user123")

    assert owner in {"node0", "node1", "node2"}


def test_same_key_same_owner():
    ring = ConsistentHashRing(
        [
            "node0",
            "node1",
            "node2",
        ]
    )

    router = RequestRouter(ring)

    assert router.primary("apple") == router.primary("apple")


def test_replicas_include_primary():
    ring = ConsistentHashRing(
        [
            "node0",
            "node1",
            "node2",
        ]
    )

    router = RequestRouter(ring)

    replicas = router.replicas("hello")

    assert len(replicas) >= 1
    assert replicas[0] == router.primary("hello")


def test_router_can_identify_non_owner():
    ring = ConsistentHashRing(
        [
            "localhost:7001",
            "localhost:7002",
            "localhost:7003",
        ]
    )

    router = RequestRouter(ring)

    owner = router.primary("some-key")

    assert owner in {
        "localhost:7001",
        "localhost:7002",
        "localhost:7003",
    }

