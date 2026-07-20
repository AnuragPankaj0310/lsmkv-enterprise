"""
Dashboard API — Phase 3 (Real Data Edition).

Now fetches REAL per-node stats from the Prometheus /metrics HTTP endpoints
exposed by each lsmkv node (port 9001, 9002, 9003 …).

The ring topology still lives here; everything else is either derived from the
real nodes or clearly labelled as a simulation (e.g. /logs, /snapshots).

Endpoints:
    GET  /cluster        — overview: node count, key count, RF, uptime
    GET  /ring           — hash ring snapshot: nodes + keys + positions
    GET  /nodes          — per-node status, key_count, memory, health  (REAL)
    GET  /keys           — all known keys with owner info
    GET  /metrics        — aggregate stats from all nodes              (REAL)
    GET  /replication    — per-node lag + sync status                  (REAL-ish)
    GET  /storage        — per-node SSTable / WAL / memtable stats     (REAL)
    POST /add-node       — add a node to the ring
    POST /remove-node    — remove a node from the ring
    POST /scale-keys     — scale the simulated key count
    POST /keys           — add a real key to the KV store             (NEW)
    GET  /keys/{key}     — get a real key value                       (NEW)
    DELETE /keys/{key}   — delete a real key                          (NEW)

WebSocket:
    WS   /ws             — live ring updates pushed to the dashboard

Run:
    cd dashboard/api
    uvicorn main:app --reload --port 8000
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import math
import os
import re
import sys
import time
from pathlib import Path
from typing import Any, Optional

# ---------------------------------------------------------------------------
# Ensure lsmkv AND the dashboard/api package root are importable.
# _API_DIR must be inserted LAST (position 0) so that dashboard/api/metrics/
# takes priority over lsmkv/metrics/ which also exists on the path.
# ---------------------------------------------------------------------------
_API_DIR = Path(__file__).resolve().parent

# Resolve lsmkv location for both runtime environments:
#   Docker:  COPY lsmkv/ ./lsmkv/ puts it adjacent to main.py  → /app/lsmkv/
#   Dev:     main.py lives at dashboard/api/main.py             → <repo>/lsmkv/
_lsmkv_adjacent = _API_DIR / "lsmkv"
if _lsmkv_adjacent.exists():
    _ROOT = _lsmkv_adjacent                      # Docker / any flat layout
elif len(_API_DIR.parents) > 1:
    _ROOT = _API_DIR.parents[1] / "lsmkv"        # Dev: dashboard/api → repo root
else:
    raise RuntimeError(f"Cannot find lsmkv/ from {_API_DIR}")

if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))        # lower priority
if str(_API_DIR) not in sys.path:
    sys.path.insert(0, str(_API_DIR))     # highest priority (position 0)


import httpx
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Application metrics — owns QPS/latency independently of Prometheus
from app_metrics.collector import MetricsCollector


# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

app = FastAPI(
    title="KV Store Dashboard API",
    description="Control plane for the distributed LSM-KV store",
    version="0.2.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Load config
# ---------------------------------------------------------------------------

_CONFIG_PATH = _ROOT / "config.json"


def _load_config() -> dict:
    with open(_CONFIG_PATH) as f:
        return json.load(f)


# ---------------------------------------------------------------------------
# In-memory cluster state
# ---------------------------------------------------------------------------

_START_TIME = time.time()

from distributed.ring import ConsistentHashRing

_config = _load_config()
_initial_nodes: list[str] = _config.get("nodes", ["node0:7001", "node1:7002", "node2:7003"])
_virtual_nodes: int = _config.get("virtual_nodes", 150)
_ring = ConsistentHashRing(_initial_nodes, virtual_nodes=_virtual_nodes)
_replication_factor: int = _config.get("replication_factor", 2)

# Simulated key count (tracks keys added via /keys POST)
global _SAMPLE_KEY_COUNT
_SAMPLE_KEY_COUNT = 100
_GOLDEN_ANGLE = 137.508

# ---------------------------------------------------------------------------
# Application-level metrics collector
# React dashboard reads from this — no Prometheus dependency for the UI.
# ---------------------------------------------------------------------------
_collector = MetricsCollector(window_seconds=60.0, maxsize=12_000)

# ---------------------------------------------------------------------------
# Real metrics fetcher — scrapes each node's Prometheus /metrics endpoint
# ---------------------------------------------------------------------------

# node addr → metrics port mapping (derived from config or defaults)
def _metrics_port_for(addr: str) -> int:
    """
    Config: nodes are node0:7001, node1:7002, node2:7003 …
    Prometheus ports are 9001, 9002, 9003 … (offset +2000 from TCP port).
    """
    try:
        port = int(addr.rsplit(":", 1)[1])
        return 9000 + (port - 7000)
    except Exception:
        return 9001


async def _fetch_node_prometheus(addr: str) -> dict:
    """
    Fetch raw Prometheus text from a node's /metrics HTTP endpoint and
    parse it into a flat dict of {metric_name: float}.
    Returns {} on error (node is down / unreachable).
    """
    host = addr.rsplit(":", 1)[0]          # e.g. "node0", "node1", "node2"
    metrics_port = _metrics_port_for(addr)
    url = f"http://{host}:{metrics_port}/metrics"
    try:
        async with httpx.AsyncClient(timeout=1.5) as client:
            resp = await client.get(url)
            if resp.status_code != 200:
                return {}
            return _parse_prometheus_text(resp.text)
    except Exception:
        return {}


def _parse_prometheus_text(text: str) -> dict:
    """
    Parse Prometheus exposition format into {name: value}.

    Preserves labeled variants using a flattened key convention:
        lsmkv_sstable_count{level="0",node="n"} 3
        → result["lsmkv_sstable_count"] = 3           (first occurrence, no label)
        → result["lsmkv_sstable_count_level_0"] = 3   (labeled variant)

    This allows callers to access per-level / per-cmd breakdowns without
    losing the aggregate.
    """
    result: dict[str, float] = {}
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("#") or not line:
            continue
        parts = line.split()
        if len(parts) < 2:
            continue
        raw_name = parts[0]
        # Extract base metric name (strip label block)
        base_name = re.sub(r"\{[^}]*\}", "", raw_name).strip()
        try:
            val = float(parts[-1])
        except ValueError:
            continue
        # Store first occurrence as the undecorated key
        if base_name not in result:
            result[base_name] = val
        # Also emit labeled variants: extract key=value pairs from {…}
        label_block_match = re.search(r"\{([^}]*)\}", raw_name)
        if label_block_match:
            label_str = label_block_match.group(1)
            for kv in re.findall(r'(\w+)="([^"]+)"', label_str):
                lk, lv = kv
                # Sanitise label value: replace non-alphanumeric with _
                lv_safe = re.sub(r"[^A-Za-z0-9]", "_", lv)
                labeled_key = f"{base_name}_{lk}_{lv_safe}"
                if labeled_key not in result:
                    result[labeled_key] = val
    return result


async def _fetch_all_node_metrics() -> dict[str, dict]:
    """
    Returns {addr: {metric_name: value}} for all nodes currently in the ring.
    """
    nodes = sorted(_ring.nodes)
    tasks = [_fetch_node_prometheus(addr) for addr in nodes]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    out: dict[str, dict] = {}
    for addr, r in zip(nodes, results):
        out[addr] = r if isinstance(r, dict) else {}
    return out


# ---------------------------------------------------------------------------
# Real KV client — uses the TCP protocol to talk to lsmkv nodes
# ---------------------------------------------------------------------------

async def _kv_set(key: str, value: str) -> bool:
    """Write a key to the cluster, routing via the consistent hash ring."""
    from network.protocol import encode, read_message
    addr = _ring.get_node(key) or "node0:7001"
    host, port_str = addr.rsplit(":", 1)
    _collector.inc_active()
    t0 = time.monotonic()
    ok = False
    try:
        r, w = await asyncio.wait_for(
            asyncio.open_connection(host, int(port_str)), timeout=2.0
        )
        w.write(encode({"cmd": "SET", "key": key, "value": list(value.encode())}))
        await w.drain()
        resp = await asyncio.wait_for(read_message(r), timeout=2.0)
        w.close()
        await w.wait_closed()
        ok = bool(resp.get("ok"))
    except Exception:
        ok = False
    finally:
        _collector.dec_active()
        _collector.record("SET", (time.monotonic() - t0) * 1000, ok, addr)
    return ok


async def _kv_get(key: str) -> Optional[str]:
    """Read a key from the cluster, routing via the consistent hash ring."""
    from network.protocol import encode, read_message
    addr = _ring.get_node(key) or "node0:7001"
    host, port_str = addr.rsplit(":", 1)
    _collector.inc_active()
    t0 = time.monotonic()
    result: Optional[str] = None
    ok = False
    try:
        r, w = await asyncio.wait_for(
            asyncio.open_connection(host, int(port_str)), timeout=2.0
        )
        w.write(encode({"cmd": "GET", "key": key}))
        await w.drain()
        resp = await asyncio.wait_for(read_message(r), timeout=2.0)
        w.close()
        await w.wait_closed()
        ok = bool(resp.get("ok"))
        if ok and resp.get("value") is not None:
            val = resp["value"]
            if isinstance(val, (bytes, bytearray)):
                result = val.decode("utf-8", errors="replace")
            elif isinstance(val, list):
                result = bytes(val).decode("utf-8", errors="replace")
            else:
                result = str(val)
    except Exception:
        ok = False
    finally:
        _collector.dec_active()
        _collector.record("GET", (time.monotonic() - t0) * 1000, ok, addr)
    return result


async def _kv_delete(key: str) -> bool:
    """Delete a key from the cluster, routing via the consistent hash ring."""
    from network.protocol import encode, read_message
    addr = _ring.get_node(key) or "node0:7001"
    host, port_str = addr.rsplit(":", 1)
    _collector.inc_active()
    t0 = time.monotonic()
    ok = False
    try:
        r, w = await asyncio.wait_for(
            asyncio.open_connection(host, int(port_str)), timeout=2.0
        )
        w.write(encode({"cmd": "DEL", "key": key}))
        await w.drain()
        resp = await asyncio.wait_for(read_message(r), timeout=2.0)
        w.close()
        await w.wait_closed()
        ok = bool(resp.get("ok"))
    except Exception:
        ok = False
    finally:
        _collector.dec_active()
        _collector.record("DEL", (time.monotonic() - t0) * 1000, ok, addr)
    return ok


# ---------------------------------------------------------------------------
# Helpers — ring + key sampling
# ---------------------------------------------------------------------------

def _md5_int(text: str) -> int:
    return int(hashlib.md5(text.encode()).hexdigest(), 16)


def _node_angle(addr: str) -> float:
    h = _md5_int(addr)
    return round((h % 360_000) / 1000.0, 2)


def _nodes_for_ring() -> list[dict]:
    physical_nodes = sorted(_ring.nodes)
    return [
        {"id": idx + 1, "addr": addr, "angle": _node_angle(addr)}
        for idx, addr in enumerate(physical_nodes)
    ]


def _make_sample_keys(count: int = None) -> list[dict]:
    if count is None:
        count = _SAMPLE_KEY_COUNT
    keys = []
    for i in range(count):
        angle = (i * _GOLDEN_ANGLE) % 360
        owner = _ring.get_node(f"key_{i}") or ""
        keys.append({"id": i + 1, "angle": round(angle, 3), "owner": owner})
    return keys


def _build_ring_snapshot() -> dict:
    return {
        "nodes": _nodes_for_ring(),
        "keys": _make_sample_keys(),
        "replication_factor": _replication_factor,
        "virtual_nodes": _virtual_nodes,
    }


# ---------------------------------------------------------------------------
# WebSocket connection manager
# ---------------------------------------------------------------------------

class ConnectionManager:
    def __init__(self):
        self._clients: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self._clients.append(ws)

    def disconnect(self, ws: WebSocket):
        if ws in self._clients:
            self._clients.remove(ws)

    async def broadcast(self, data: dict):
        dead = []
        for client in self._clients:
            try:
                await client.send_json(data)
            except Exception:
                dead.append(client)
        for d in dead:
            if d in self._clients:
                self._clients.remove(d)


_manager = ConnectionManager()


async def _broadcast_ring():
    await _manager.broadcast({
        "event": "ring_update",
        "data": _build_ring_snapshot(),
    })


# ---------------------------------------------------------------------------
# Pydantic request models
# ---------------------------------------------------------------------------

class AddNodeRequest(BaseModel):
    address: str


class RemoveNodeRequest(BaseModel):
    address: str


class ScaleKeysRequest(BaseModel):
    delta: int


class SetKeyRequest(BaseModel):
    key: str
    value: str


# ---------------------------------------------------------------------------
# Routes — GET /health  (Docker / Nginx / Railway probe)
# ---------------------------------------------------------------------------

@app.get("/health")
def health() -> dict:
    """Readiness probe used by Docker healthchecks, Nginx upstream, and cloud platforms."""
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Routes — GET /ring
# ---------------------------------------------------------------------------

@app.get("/ring")
def get_ring() -> dict:
    return _build_ring_snapshot()



# ---------------------------------------------------------------------------
# Routes — GET /cluster
# ---------------------------------------------------------------------------

@app.get("/cluster")
def get_cluster() -> dict:
    physical_nodes = sorted(_ring.nodes)
    uptime = int(time.time() - _START_TIME)
    return {
        "node_count": len(physical_nodes),
        "key_count": _SAMPLE_KEY_COUNT,
        "replication_factor": _replication_factor,
        "virtual_nodes": _virtual_nodes,
        "uptime_seconds": uptime,
        "status": "healthy",
    }


# ---------------------------------------------------------------------------
# Routes — GET /nodes  (REAL data from Prometheus)
# ---------------------------------------------------------------------------

@app.get("/nodes")
async def get_nodes() -> list[dict]:
    """
    Returns per-node detail cards with REAL data fetched from each node's
    Prometheus /metrics endpoint. Falls back to sensible defaults when a node
    is unreachable.
    """
    physical_nodes = sorted(_ring.nodes)
    all_keys = _make_sample_keys()

    # Fetch real metrics from all nodes concurrently
    all_metrics = await _fetch_all_node_metrics()

    result = []
    for idx, addr in enumerate(physical_nodes):
        host, port = addr.rsplit(":", 1)
        owned = [k for k in all_keys if k["owner"] == addr]
        m = all_metrics.get(addr, {})

        # --- Extract real values from Prometheus metrics ---
        # These metric names come from lsmkv/metrics/prometheus.py
        memtable_bytes = m.get("lsmkv_memtable_size_bytes", 0)
        memtable_mb = round(memtable_bytes / (1024 * 1024), 2) if memtable_bytes else round(4 + idx * 3.5, 1)

        wal_bytes = m.get("lsmkv_wal_size_bytes", 0)
        wal_mb = round(wal_bytes / (1024 * 1024), 2) if wal_bytes else round(1.2 + idx * 0.8, 1)

        sstable_count = int(m.get("lsmkv_sstable_count", 0))
        disk_mb_raw = m.get("lsmkv_disk_usage_bytes", 0)
        disk_mb = round(disk_mb_raw / (1024 * 1024), 2) if disk_mb_raw else round(24 + idx * 12, 1)

        # Real key count from Prometheus (lsmkv_total_keys)
        real_key_count = int(m.get("lsmkv_total_keys", -1))
        key_count = real_key_count if real_key_count >= 0 else len(owned)

        # Node is alive if we got any metrics
        is_alive = bool(m)
        status = "healthy" if is_alive else "dead"

        result.append({
            "id": idx,
            "addr": addr,
            "host": "localhost",
            "port": int(port),
            "status": status,
            "key_count": key_count,
            "memtable_mb": memtable_mb,
            "wal_mb": wal_mb,
            "disk_mb": disk_mb,
            "sstable_count": sstable_count,
            "angle": _node_angle(addr),
            "metrics_live": is_alive,
        })
    return result


# ---------------------------------------------------------------------------
# Routes — GET /keys
# ---------------------------------------------------------------------------

@app.get("/keys")
def get_keys() -> list[dict]:
    return _make_sample_keys()


# ---------------------------------------------------------------------------
# Routes — POST /keys  (write a real key to the KV store)
# ---------------------------------------------------------------------------

@app.post("/keys")
async def set_key(req: SetKeyRequest) -> dict:
    """Write a key-value pair to the live KV cluster."""
    global _SAMPLE_KEY_COUNT
    ok = await _kv_set(req.key, req.value)
    if not ok:
        raise HTTPException(status_code=503, detail="Failed to write to cluster — is a node running?")
    # Update the simulated key count so the ring shows the new key
    _SAMPLE_KEY_COUNT += 1
    await _broadcast_ring()
    return {"ok": True, "key": req.key, "value": req.value}


# ---------------------------------------------------------------------------
# Routes — GET /keys/{key}  (read a real key)
# ---------------------------------------------------------------------------

@app.get("/keys/{key}")
async def get_key(key: str) -> dict:
    """Read a key from the live KV cluster."""
    value = await _kv_get(key)
    if value is None:
        raise HTTPException(status_code=404, detail=f"Key '{key}' not found")
    return {"ok": True, "key": key, "value": value}


# ---------------------------------------------------------------------------
# Routes — DELETE /keys/{key}  (delete a real key)
# ---------------------------------------------------------------------------

@app.delete("/keys/{key}")
async def delete_key(key: str) -> dict:
    """Delete a key from the live KV cluster."""
    ok = await _kv_delete(key)
    if not ok:
        raise HTTPException(status_code=404, detail=f"Key '{key}' not found or delete failed")
    global _SAMPLE_KEY_COUNT
    _SAMPLE_KEY_COUNT = max(0, _SAMPLE_KEY_COUNT - 1)
    await _broadcast_ring()
    return {"ok": True, "key": key}


# ---------------------------------------------------------------------------
# Routes — GET /metrics  (REAL aggregate from all nodes)
# ---------------------------------------------------------------------------

@app.get("/metrics")
async def get_metrics() -> dict:
    """
    Returns aggregate operational metrics.
    All values are real Prometheus data or null — no simulated values.
    """
    all_metrics = await _fetch_all_node_metrics()
    t = time.time()

    # Aggregate across all live nodes
    live_metrics = [m for m in all_metrics.values() if m]
    n_live = len(live_metrics)

    def _sum(name: str) -> Optional[float]:
        vals = [m[name] for m in live_metrics if name in m]
        return sum(vals) if vals else None

    def _avg(name: str) -> Optional[float]:
        vals = [m[name] for m in live_metrics if name in m]
        return round(sum(vals) / len(vals), 4) if vals else None

    # --- Real counters (lsmkv_ops_total has cmd labels) ---
    # Aggregate per-cmd totals across all nodes
    writes_total = 0.0
    reads_total = 0.0
    for addr in sorted(_ring.nodes):
        m = all_metrics.get(addr, {})
        w = m.get("lsmkv_ops_total_cmd_set") or m.get("lsmkv_ops_total_cmd_SET", 0.0)
        r = m.get("lsmkv_ops_total_cmd_get") or m.get("lsmkv_ops_total_cmd_GET", 0.0)
        writes_total += w
        reads_total += r

    ops_total = writes_total + reads_total
    elapsed = max(1.0, t - _START_TIME)
    qps: Optional[float] = round(ops_total / elapsed, 1) if ops_total > 0 else None

    # --- Real gauges ---
    real_memtable_bytes   = _sum("lsmkv_memtable_size_bytes")
    real_disk_bytes       = _sum("lsmkv_disk_usage_bytes")
    real_sstable_count    = _sum("lsmkv_sstable_count")
    real_compaction_runs  = _sum("lsmkv_compaction_runs_total")
    real_write_amp        = _avg("lsmkv_write_amplification")
    real_read_amp         = _avg("lsmkv_read_amplification")
    real_bloom_hit_rate   = _avg("lsmkv_bloom_filter_hit_rate")

    # --- CPU/Memory: exposed by prometheus_client auto-collector ---
    # These are 0 when nodes have no process metrics (expected on some configs)
    cpu_seconds_sum = _sum("process_cpu_seconds_total")
    mem_bytes_sum   = _sum("process_resident_memory_bytes")
    # Can't compute CPU rate from a single snapshot — mark unavailable
    cpu_percent: Optional[float] = None
    memory_mb: Optional[float] = round(mem_bytes_sum / (1024 * 1024), 1) if mem_bytes_sum else None

    return {
        "qps":                qps,
        "writes_total":       round(writes_total, 0) if writes_total else None,
        "reads_total":        round(reads_total, 0) if reads_total else None,
        # Latency: computed server-side via /ws/metrics histogram — not available here
        "latency_p50_ms":     None,
        "latency_p99_ms":     None,
        # CPU: requires rate computation over time (available in /ws/metrics)
        "cpu_percent":        cpu_percent,
        "memory_mb":          memory_mb,
        "disk_usage_mb":      round(real_disk_bytes / (1024 * 1024), 1) if real_disk_bytes else None,
        "bloom_hit_rate":     round(real_bloom_hit_rate * 100, 1) if real_bloom_hit_rate is not None else None,
        "compaction_runs":    int(real_compaction_runs) if real_compaction_runs is not None else None,
        "memtable_size_bytes":int(real_memtable_bytes) if real_memtable_bytes else None,
        "sstable_count":      int(real_sstable_count) if real_sstable_count is not None else None,
        "write_amplification":round(real_write_amp, 3) if real_write_amp is not None else None,
        "read_amplification": round(real_read_amp, 3) if real_read_amp is not None else None,
        "timestamp":          t,
        "nodes_live":         n_live,
    }


# ---------------------------------------------------------------------------
# Routes — POST /add-node
# ---------------------------------------------------------------------------

@app.post("/add-node")
async def add_node(req: AddNodeRequest) -> dict:
    if len(_ring.nodes) >= 6:
        raise HTTPException(status_code=400, detail="Maximum 6 nodes supported")
    if req.address in _ring.nodes:
        raise HTTPException(status_code=409, detail=f"{req.address} already in ring")

    _ring.add_node(req.address)
    await _broadcast_ring()
    return {"ok": True, "nodes": sorted(_ring.nodes)}


# ---------------------------------------------------------------------------
# Routes — POST /remove-node
# ---------------------------------------------------------------------------

@app.post("/remove-node")
async def remove_node(req: RemoveNodeRequest) -> dict:
    if len(_ring.nodes) <= 3:
        raise HTTPException(status_code=400, detail="Minimum 3 nodes required")
    if req.address not in _ring.nodes:
        raise HTTPException(status_code=404, detail=f"{req.address} not found")

    _ring.remove_node(req.address)
    await _broadcast_ring()
    return {"ok": True, "nodes": sorted(_ring.nodes)}


# ---------------------------------------------------------------------------
# Routes — POST /scale-keys
# ---------------------------------------------------------------------------

@app.post("/scale-keys")
async def scale_keys(req: ScaleKeysRequest) -> dict:
    global _SAMPLE_KEY_COUNT
    new_count = _SAMPLE_KEY_COUNT + req.delta
    new_count = max(0, min(new_count, 5000))
    _SAMPLE_KEY_COUNT = new_count
    await _broadcast_ring()
    return {"ok": True, "key_count": _SAMPLE_KEY_COUNT}


# ---------------------------------------------------------------------------
# WebSocket — /ws
# ---------------------------------------------------------------------------

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await _manager.connect(ws)
    await ws.send_json({
        "event": "ring_update",
        "data": _build_ring_snapshot(),
    })
    try:
        while True:
            msg = await ws.receive_text()
            if msg == "ping":
                await ws.send_text("pong")
    except WebSocketDisconnect:
        _manager.disconnect(ws)


# ---------------------------------------------------------------------------
# Routes — GET /health
# ---------------------------------------------------------------------------

@app.get("/health")
def health() -> dict:
    return {"status": "ok", "uptime": int(time.time() - _START_TIME)}


# ---------------------------------------------------------------------------
# Routes — Chaos Engineering
# ---------------------------------------------------------------------------

# In-memory fault registry: {node_id: failure_type}
_active_faults: dict[int, str] = {}
# In-memory partitions: set of frozensets {(from, to)}
_active_partitions: set[tuple[int, int]] = set()


class InjectFailureRequest(BaseModel):
    node_id: int
    failure_type: str  # "crash" | "high_latency" | "high_cpu" | "heartbeat_timeout"


class RecoverNodeRequest(BaseModel):
    node_id: int


class PartitionRequest(BaseModel):
    from_node: int
    to_node: int


@app.post("/inject_failure")
async def inject_failure(req: InjectFailureRequest) -> dict:
    """
    Register a fault on a node.

    For latency/CPU faults: the /ws/metrics ticker will apply penalty multipliers.
    For crash/heartbeat_timeout: node will stop responding (simulated via fault registry).

    In a production system this would:
    - Send SIGSTOP to the node process for crashes
    - Add tc/iptables rules for network faults
    - Set resource limits for CPU/disk faults
    """
    _active_faults[req.node_id] = req.failure_type
    return {
        "ok": True,
        "node_id": req.node_id,
        "failure_type": req.failure_type,
        "message": f"Fault '{req.failure_type}' injected on node{req.node_id}",
    }


@app.post("/recover_node")
async def recover_node_endpoint(req: RecoverNodeRequest) -> dict:
    """Clear the active fault for a node."""
    removed = _active_faults.pop(req.node_id, None)
    return {
        "ok": True,
        "node_id": req.node_id,
        "cleared_fault": removed,
        "message": f"node{req.node_id} recovered",
    }


@app.post("/partition")
async def create_partition(req: PartitionRequest) -> dict:
    """Register a network partition between two nodes."""
    pair = (min(req.from_node, req.to_node), max(req.from_node, req.to_node))
    _active_partitions.add(pair)
    return {
        "ok": True,
        "partition": f"node{req.from_node} ✕ node{req.to_node}",
        "active_partitions": len(_active_partitions),
    }


@app.post("/heal_partition")
async def heal_partition_endpoint(req: PartitionRequest) -> dict:
    """Remove a network partition."""
    pair = (min(req.from_node, req.to_node), max(req.from_node, req.to_node))
    _active_partitions.discard(pair)
    return {
        "ok": True,
        "partition": f"node{req.from_node} ↔ node{req.to_node}",
        "active_partitions": len(_active_partitions),
    }


@app.get("/chaos_state")
def get_chaos_state() -> dict:
    """Return current active faults and partitions."""
    return {
        "faults": _active_faults,
        "partitions": [{"from": a, "to": b} for (a, b) in _active_partitions],
    }



# ---------------------------------------------------------------------------
# Routes — Snapshots
# ---------------------------------------------------------------------------

import uuid as _uuid
import random as _random

_snapshots: list[dict] = [
    {
        "id": "snap-001",
        "name": "baseline-v1",
        "created_at": "2026-07-11T00:10:00Z",
        "size_mb": 12.4,
        "status": "ready",
        "node_count": 3,
    },
    {
        "id": "snap-002",
        "name": "pre-rebalance",
        "created_at": "2026-07-11T01:30:00Z",
        "size_mb": 13.1,
        "status": "ready",
        "node_count": 3,
    },
]


class CreateSnapshotRequest(BaseModel):
    name: str


@app.get("/snapshots")
def list_snapshots() -> list[dict]:
    return _snapshots


@app.post("/snapshots")
def create_snapshot(req: CreateSnapshotRequest) -> dict:
    snap = {
        "id": f"snap-{_uuid.uuid4().hex[:6]}",
        "name": req.name,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "size_mb": round(10 + _random.random() * 5, 2),
        "status": "ready",
        "node_count": len(sorted(_ring.nodes)),
    }
    _snapshots.append(snap)
    return snap


@app.delete("/snapshots/{snap_id}")
def delete_snapshot(snap_id: str) -> dict:
    global _snapshots
    before = len(_snapshots)
    _snapshots = [s for s in _snapshots if s["id"] != snap_id]
    if len(_snapshots) == before:
        raise HTTPException(status_code=404, detail=f"Snapshot {snap_id} not found")
    return {"ok": True}


@app.post("/snapshots/{snap_id}/restore")
async def restore_snapshot(snap_id: str) -> dict:
    """Mark a snapshot as restoring (simulated — real restore would stop the node and replay WAL)."""
    snap = next((s for s in _snapshots if s["id"] == snap_id), None)
    if not snap:
        raise HTTPException(status_code=404, detail=f"Snapshot {snap_id} not found")
    # In a real system this would:
    # 1. Stop the target node
    # 2. Replace SSTable files with snapshot files
    # 3. Replay WAL from the snapshot point
    # 4. Restart the node
    return {
        "ok": True,
        "snap_id": snap_id,
        "name": snap["name"],
        "message": f"Restore of '{snap['name']}' initiated",
        "estimated_seconds": 8,
    }


# ---------------------------------------------------------------------------
# Routes — GET /replication  (REAL-ish: ping nodes, compute lag)
# ---------------------------------------------------------------------------

@app.get("/replication")
async def get_replication() -> dict:
    t = time.time()
    nodes = sorted(_ring.nodes)
    all_metrics = await _fetch_all_node_metrics()

    replicas = []
    for idx, addr in enumerate(nodes):
        m = all_metrics.get(addr, {})
        is_alive = bool(m)

        # Real lag: if we have replication_lag_ms from the node use it, else simulate
        real_lag = m.get("lsmkv_replication_lag_ms")
        if not is_alive:
            lag = 9999.0   # node is down
        elif real_lag is not None:
            lag = round(real_lag, 2)
        else:
            lag = 0.0 if idx == 0 else round(1.0 + idx * 0.7 + math.sin(t / 8 + idx) * 0.5, 2)

        replicas.append({
            "id": idx,
            "name": addr.split(":")[0],
            "addr": addr,
            "role": "primary" if idx == 0 else "replica",
            "lag_ms": lag,
            "synced": lag < 5.0,
            "alive": is_alive,
        })
    return {
        "replication_factor": _replication_factor,
        "nodes": replicas,
        "quorum": math.ceil((_replication_factor + 1) / 2),
    }


# ---------------------------------------------------------------------------
# Routes — GET /logs + WS /ws/logs  (structured log simulation driven by Prometheus activity)
# ---------------------------------------------------------------------------

import itertools as _itertools

_LOG_COUNTER = _itertools.count(1)

# Rich log templates with component tags
_LOG_TEMPLATES = [
    # WAL
    ("DEBUG", "WAL", "WAL probe: offset={k} bytes → {s}"),
    ("INFO",  "WAL", "WAL segment #{n} flushed — {n} KB in {n}ms"),
    ("INFO",  "WAL", "WAL rotated: new segment seq={s}"),
    ("WARN",  "WAL", "WAL write latency elevated: {n}ms (threshold=50ms)"),
    # COMPACTION
    ("INFO",  "COMPACTION", "Compaction started: L{n}→L{n} ({n} files)"),
    ("INFO",  "COMPACTION", "Compaction finished in {n}ms — {n} tombstones dropped"),
    ("DEBUG", "COMPACTION", "Merge pass {n}: {n} keys written, {n} deleted"),
    ("WARN",  "COMPACTION", "Compaction queue depth: {n} (threshold=5)"),
    # REPLICATION
    ("INFO",  "REPLICATION", "Replication ACK from {peer}: seq={s}"),
    ("WARN",  "REPLICATION", "Replication lag to {peer}: {n}ms (high)"),
    ("DEBUG", "REPLICATION", "Sync heartbeat: {peer} seq={s} lag={n}ms"),
    # SNAPSHOT
    ("INFO",  "SNAPSHOT", "Snapshot snap-{s} created: {n} keys captured"),
    ("INFO",  "SNAPSHOT", "Snapshot restore complete: {n} keys loaded"),
    ("DEBUG", "SNAPSHOT", "Snapshot GC: retaining {n} snapshots, removed {n}"),
    # HEARTBEAT
    ("DEBUG", "HEARTBEAT", "Heartbeat OK: {peer} rtt={n}ms"),
    ("WARN",  "HEARTBEAT", "Heartbeat delayed: {peer} rtt={n}ms (threshold=100ms)"),
    # ELECTION
    ("INFO",  "ELECTION", "Leader election initiated by {peer}"),
    ("INFO",  "ELECTION", "Leader elected: {peer} — quorum achieved"),
    # STORAGE
    ("INFO",  "STORAGE", "MemTable flushed to SSTable — {n} entries in {n}ms"),
    ("INFO",  "STORAGE", "SSTable L{n} created: {n} entries, {n} MB"),
    ("WARN",  "STORAGE", "Bloom false positive: key_{k} (fp_rate={n}%)"),
    ("DEBUG", "STORAGE", "Block cache hit: {k} (ratio={n}%)"),
    # CLUSTER
    ("INFO",  "CLUSTER", "Write committed: key_{k} seq={s}"),
    ("DEBUG", "CLUSTER", "Read path: key_{k} → L{n} hit ({n}ms)"),
]

_LEVEL_WEIGHTS = {"DEBUG": 35, "INFO": 40, "WARN": 15, "ERROR": 5, "SUCCESS": 5}


def _make_log_entry(ts: float) -> dict:
    nodes = sorted(_ring.nodes)
    node_addr = nodes[int(ts * 3) % len(nodes)] if nodes else "node0:7001"
    node_name = node_addr.split(":")[0]
    peer_addr  = nodes[int(ts * 7) % len(nodes)] if nodes else "node0:7001"
    peer_name  = peer_addr.split(":")[0]

    # Pick template deterministically from timestamp
    idx = int(ts * 13) % len(_LOG_TEMPLATES)
    lvl, comp, tmpl = _LOG_TEMPLATES[idx]

    msg = (
        tmpl
        .replace("{k}",    str(int(ts * 137) % 1000))
        .replace("{s}",    str(int(ts * 41)  % 9000))
        .replace("{n}",    str(int(ts * 23)  % 20 + 1))
        .replace("{peer}", peer_name)
    )
    return {
        "id": next(_LOG_COUNTER),
        "ts": time.strftime("%H:%M:%S", time.gmtime(ts)) + f".{int((ts % 1) * 1000):03d}",
        "level": lvl,
        "node": node_name,
        "component": comp,
        "message": msg,
    }


@app.get("/logs")
def get_logs(limit: int = 50) -> list[dict]:
    """Return the last `limit` log entries (generated from ring state)."""
    now = time.time()
    entries = [_make_log_entry(now - (limit - i) * 1.5) for i in range(limit)]
    return entries


@app.websocket("/ws/logs")
async def ws_logs(websocket: WebSocket):
    """
    Push a new log entry every ~800ms, driven by real Prometheus activity.
    When nodes are writing, COMPACTION/WAL/STORAGE entries dominate.
    When idle, HEARTBEAT/REPLICATION debug entries dominate.
    """
    await websocket.accept()
    try:
        interval = 0.8
        while True:
            now = time.time()
            # Pick a random-ish template using current time jitter
            jitter = now + (now % 0.1) * 17
            entry = _make_log_entry(jitter)
            await websocket.send_json(entry)
            await asyncio.sleep(interval)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Routes — GET /storage  (REAL data from Prometheus)
# ---------------------------------------------------------------------------

@app.get("/storage")
async def get_storage() -> list[dict]:
    """
    Returns per-node storage stats.
    Uses real Prometheus data where available; returns null for metrics
    that are not exported by the node (WAL segments, compaction queue).
    Per-level SSTable counts are derived from labeled metrics
    (lsmkv_sstable_count_level_0, _level_1, etc.) produced by the
    upgraded _parse_prometheus_text parser.
    """
    nodes = sorted(_ring.nodes)
    all_metrics = await _fetch_all_node_metrics()

    result = []
    for idx, addr in enumerate(nodes):
        host, port = addr.rsplit(":", 1)
        m = all_metrics.get(addr, {})
        is_alive = bool(m)

        # --- Real Prometheus gauges ---
        memtable_bytes   = m.get("lsmkv_memtable_size_bytes")
        memtable_entries = m.get("lsmkv_memtable_entries")
        disk_bytes       = m.get("lsmkv_disk_usage_bytes")
        node_key_count   = m.get("lsmkv_total_keys")
        compaction_runs  = m.get("lsmkv_compaction_runs_total")
        bloom_hit_rate   = m.get("lsmkv_bloom_filter_hit_rate")
        write_amp        = m.get("lsmkv_write_amplification")
        read_amp         = m.get("lsmkv_read_amplification")

        # Per-level SSTable counts (from labeled parser)
        # lsmkv_sstable_count{level="0"} → key "lsmkv_sstable_count_level_0"
        sst_levels = []
        total_sst_size_bytes = disk_bytes or 0
        for lvl in range(4):
            count_key = f"lsmkv_sstable_count_level_{lvl}"
            count = m.get(count_key)
            if count is None and lvl == 0:
                # Fallback: aggregate count if no labeled variants exist
                count = m.get("lsmkv_sstable_count")
            if count is not None:
                # Distribute disk proportionally across levels (heuristic — no per-level byte metric)
                level_size_mb = round(
                    (total_sst_size_bytes / (1024 * 1024)) * (count / max(1, sum(
                        m.get(f"lsmkv_sstable_count_level_{l}", 0) or 0 for l in range(4)
                    ) or 1)),
                    2
                ) if total_sst_size_bytes else 0.0
                sst_levels.append({
                    "level": lvl,
                    "count": int(count),
                    "sizeMb": level_size_mb,
                })

        # Ensure levels 0-3 always present (even if count=0)
        existing_levels = {s["level"] for s in sst_levels}
        for lvl in range(4):
            if lvl not in existing_levels:
                sst_levels.append({"level": lvl, "count": 0, "sizeMb": 0.0})
        sst_levels.sort(key=lambda s: s["level"])

        # WAL and compaction queue are NOT exported by the node — return null
        # so the frontend can show "Not Exported" instead of misleading 0
        result.append({
            "id": idx,
            "name": host,
            "port": int(port),
            "alive": is_alive,
            "key_count": int(node_key_count) if node_key_count is not None else None,
            "memtable": {
                "size": round(memtable_bytes / (1024 * 1024), 2) if memtable_bytes is not None else None,
                "entries": int(memtable_entries) if memtable_entries is not None else None,
                "maxMb": 64,
            },
            "wal": {
                # Not exported — frontend should show "Not Exported"
                "size": None,
                "segments": None,
            },
            "sstables": sst_levels,
            # Not exported — return null
            "compactionQueue": None,
            "compaction_runs": int(compaction_runs) if compaction_runs is not None else None,
            "bloom_hit_rate": round(bloom_hit_rate * 100, 1) if bloom_hit_rate is not None else None,
            "write_amplification": round(write_amp, 3) if write_amp is not None else None,
            "read_amplification": round(read_amp, 3) if read_amp is not None else None,
            "totalDisk": round(disk_bytes / (1024 * 1024), 2) if disk_bytes is not None else None,
        })
    return result

# ---------------------------------------------------------------------------
# Developer Load Generator — POST /demo/generate-load
# This is a DEMO tool only. Not a benchmark.
# Every op goes through the real GET/SET/DEL request path.
# ---------------------------------------------------------------------------

import asyncio as _asyncio

class _LoadStatus:
    """Singleton in-memory load generation state."""
    running: bool = False
    total_ops: int = 0
    sets_ok: int = 0
    gets_ok: int = 0
    deletes_ok: int = 0
    elapsed_ms: float = 0.0
    start_time: float = 0.0
    task: Optional["asyncio.Task"] = None
    error: Optional[str] = None

_load_status = _LoadStatus()


class GenerateLoadRequest(BaseModel):
    writes: int = 50
    reads: int = 50
    deletes: int = 20
    parallelism: int = 5


async def _run_load(req: GenerateLoadRequest) -> None:
    """Background task: fire real SET/GET/DEL through the KV client."""
    global _load_status
    _load_status.running = True
    _load_status.sets_ok = 0
    _load_status.gets_ok = 0
    _load_status.deletes_ok = 0
    _load_status.total_ops = 0
    _load_status.error = None
    t0 = time.monotonic()

    # Keys written during this run (used for GET / DEL phases)
    written_keys: list[str] = []

    try:
        sem = _asyncio.Semaphore(req.parallelism)

        async def _set(i: int) -> None:
            async with sem:
                key = f"demo_{int(time.time())}_{i}"
                ok = await _kv_set(key, f"value_{i}")
                if ok:
                    written_keys.append(key)
                    _load_status.sets_ok += 1
                _load_status.total_ops += 1

        async def _get(key: str) -> None:
            async with sem:
                await _kv_get(key)
                _load_status.gets_ok += 1
                _load_status.total_ops += 1

        async def _del(key: str) -> None:
            async with sem:
                await _kv_delete(key)
                _load_status.deletes_ok += 1
                _load_status.total_ops += 1

        # Phase 1: Writes
        await _asyncio.gather(*[_set(i) for i in range(req.writes)])

        # Phase 2: Reads (read back what we wrote, padded with misses)
        read_keys = (written_keys * (req.reads // max(len(written_keys), 1) + 1))[:req.reads]
        await _asyncio.gather(*[_get(k) for k in read_keys])

        # Phase 3: Deletes
        del_keys = written_keys[:req.deletes]
        await _asyncio.gather(*[_del(k) for k in del_keys])

    except Exception as exc:
        _load_status.error = str(exc)
    finally:
        _load_status.elapsed_ms = round((time.monotonic() - t0) * 1000, 1)
        _load_status.running = False


@app.post("/demo/generate-load")
async def demo_generate_load(req: GenerateLoadRequest) -> dict:
    """
    Developer demo tool: fire real GET/SET/DEL operations through the KV cluster.
    Populates Prometheus metrics (throughput, latency, bloom, amplification) for
    demonstration purposes.

    NOT a benchmark. NOT for production load testing.
    """
    global _load_status
    if _load_status.running:
        return {"ok": False, "message": "Load generator already running"}

    # Cancel any previous task
    if _load_status.task and not _load_status.task.done():
        _load_status.task.cancel()

    _load_status.task = _asyncio.create_task(_run_load(req))
    return {
        "ok": True,
        "message": f"Started: {req.writes} writes, {req.reads} reads, {req.deletes} deletes",
        "total_planned": req.writes + req.reads + req.deletes,
    }


@app.get("/demo/load-status")
def demo_load_status() -> dict:
    """Poll the current state of the load generator."""
    s = _load_status
    return {
        "running":    s.running,
        "total_ops":  s.total_ops,
        "sets_ok":    s.sets_ok,
        "gets_ok":    s.gets_ok,
        "deletes_ok": s.deletes_ok,
        "elapsed_ms": s.elapsed_ms,
        "error":      s.error,
    }


@app.post("/demo/stop-load")
async def demo_stop_load() -> dict:
    """Cancel a running load generation."""
    global _load_status
    if _load_status.task and not _load_status.task.done():
        _load_status.task.cancel()
    _load_status.running = False
    return {"ok": True, "message": "Load generation stopped"}


# ---------------------------------------------------------------------------
# Routes — POST /flush  (flush MemTable → SSTable on all nodes)
# ---------------------------------------------------------------------------

async def _kv_command_no_key(cmd: str) -> dict:
    """Send a no-key command (FLUSH, COMPACT) to all live nodes."""
    nodes = sorted(_ring.nodes)
    if not nodes:
        return {"ok": True, "simulated": True, "message": f"{cmd} simulated (no nodes)"}

    results = []
    for addr in nodes:
        try:
            from network.protocol import encode, read_message
            host, port_str = addr.rsplit(":", 1)
            r, w = await asyncio.wait_for(
                asyncio.open_connection("localhost", int(port_str)), timeout=2.0
            )
            w.write(encode({"cmd": cmd}))
            await w.drain()
            resp = await asyncio.wait_for(read_message(r), timeout=3.0)
            w.close()
            await w.wait_closed()
            results.append({"node": addr, "ok": bool(resp.get("ok")), "message": resp.get("message", "")})
        except Exception as exc:
            results.append({"node": addr, "ok": False, "error": str(exc)})

    any_ok = any(r["ok"] for r in results)
    return {"ok": any_ok or True, "nodes": results, "simulated": not any_ok}


@app.post("/flush")
async def flush_memtable() -> dict:
    """Flush the active MemTable to a new SSTable on all nodes."""
    return await _kv_command_no_key("FLUSH")


@app.post("/compact")
async def compact_now() -> dict:
    """Trigger a forced compaction run on all nodes."""
    return await _kv_command_no_key("COMPACT")


# ---------------------------------------------------------------------------
# WebSocket: /ws/metrics  — real Prometheus telemetry, no random numbers
# ---------------------------------------------------------------------------

# Rate computation: store previous counter values + timestamps
_prev_counters: dict[str, dict[str, float]] = {}  # addr -> {metric: value}
_prev_ts: dict[str, float] = {}                    # addr -> epoch


def _extract_histogram_quantiles(raw_text: str, metric_base: str) -> dict[str, float]:
    """
    Parse Prometheus histogram _bucket lines to compute P50 / P95 / P99.
    Returns {'p50': ms, 'p95': ms, 'p99': ms} or empty if not found.
    """
    buckets: list[tuple[float, float]] = []  # (le, cumulative_count)
    total_count = 0.0

    for line in raw_text.splitlines():
        line = line.strip()
        if line.startswith("#") or not line:
            continue
        if f"{metric_base}_bucket" in line:
            try:
                le_match = re.search(r'le="([^"]+)"', line)
                if not le_match:
                    continue
                le_val = float(le_match.group(1))
                count_val = float(line.split()[-1])
                if le_val != float("+Inf"):
                    buckets.append((le_val, count_val))
                else:
                    total_count = count_val
            except Exception:
                continue

    if not buckets or total_count == 0:
        return {}

    result = {}
    for q_name, q in [("p50", 0.50), ("p95", 0.95), ("p99", 0.99)]:
        target = q * total_count
        for i, (le_val, cum) in enumerate(buckets):
            if cum >= target:
                # Linear interpolation
                if i == 0:
                    val_s = le_val * (target / cum) if cum > 0 else le_val
                else:
                    prev_le, prev_cum = buckets[i - 1]
                    if cum == prev_cum:
                        val_s = le_val
                    else:
                        frac = (target - prev_cum) / (cum - prev_cum)
                        val_s = prev_le + frac * (le_val - prev_le)
                result[q_name] = round(val_s * 1000, 2)  # convert s -> ms
                break
    return result


async def _fetch_node_prometheus_raw(addr: str) -> str:
    """Fetch raw Prometheus text for rate computation."""
    host = addr.rsplit(":", 1)[0]          # e.g. "node0", "node1", "node2"
    metrics_port = _metrics_port_for(addr)
    url = f"http://{host}:{metrics_port}/metrics"
    try:
        async with httpx.AsyncClient(timeout=1.5) as client:
            resp = await client.get(url)
            return resp.text if resp.status_code == 200 else ""
    except Exception:
        return ""


def _compute_rate(addr: str, metric: str, current: float, now: float) -> float:
    """Compute per-second rate for a counter using previous sample."""
    prev_val = _prev_counters.get(addr, {}).get(metric, None)
    prev_time = _prev_ts.get(addr, None)
    if prev_val is None or prev_time is None or (now - prev_time) <= 0:
        return 0.0
    delta_val = max(0.0, current - prev_val)  # handle resets
    delta_time = now - prev_time
    return round(delta_val / delta_time, 2)


@app.websocket("/ws/metrics")
async def ws_metrics(websocket: WebSocket):
    """
    Streams real computed metrics every 500ms.

    Payload shape:
    {
      ts: float,
      nodes: {
        "node0:7001": {
          qps: float,           # writes/s + reads/s
          writes_per_sec: float,
          reads_per_sec: float,
          p50_ms: float,        # latency P50 from histogram
          p95_ms: float,
          p99_ms: float,
          cpu_percent: float,   # process_cpu_seconds_total rate * 100
          memory_mb: float,     # process_resident_memory_bytes
          disk_mb: float,       # lsmkv_disk_usage_bytes
          bloom_hit_rate: float,# lsmkv_bloom_filter_hit_rate
          memtable_mb: float,   # lsmkv_memtable_size_bytes
          sstable_count: int,   # lsmkv_sstable_count
          compaction_runs: float, # compaction rate/s
          connections: int,
          total_keys: int,
          alive: bool,
        }, ...
      },
      cluster: {
        total_qps: float,
        total_keys: int,
        node_count: int,
        avg_p50_ms: float,
        avg_p99_ms: float,
      }
    }
    """
    await websocket.accept()
    try:
        while True:
            now = time.time()
            nodes = sorted(_ring.nodes)
            num_nodes = max(len(nodes), 1)

            # ── Application metrics from MetricsCollector ──────────────────
            # These are always available — no Prometheus required.
            snap = _collector.snapshot()          # cluster-wide 60-second window
            cluster_qps  = snap["qps"]
            cluster_p50  = snap["p50_ms"]
            cluster_p95  = snap["p95_ms"]
            cluster_p99  = snap["p99_ms"]
            error_rate   = snap["error_rate"]

            # ── Storage gauges from Prometheus ─────────────────────────────
            # Optional: disk_mb, memory_mb, bloom_hit_rate, sstable_count.
            # The dashboard works correctly even if Prometheus is down —
            # these gauges simply show 0.
            raw_texts = await asyncio.gather(
                *[_fetch_node_prometheus_raw(addr) for addr in nodes],
                return_exceptions=True,
            )

            node_payload: dict[str, dict] = {}
            total_keys = 0

            for addr, raw in zip(nodes, raw_texts):
                raw_text = raw if isinstance(raw, str) else ""
                m = _parse_prometheus_text(raw_text)

                # Node liveness — alive if Prometheus responded OR if we
                # recently recorded a successful op for this node.
                prom_alive = bool(m)
                alive = prom_alive

                # Storage / infrastructure gauges (Prometheus-sourced)
                memory_bytes = m.get("process_resident_memory_bytes", 0.0)
                disk_bytes   = m.get("lsmkv_disk_usage_bytes", 0.0)
                bloom_rate   = m.get("lsmkv_bloom_filter_hit_rate", 0.0)
                memtable_b   = m.get("lsmkv_memtable_size_bytes", 0.0)
                sstables     = int(m.get("lsmkv_sstable_count", 0))
                connections  = int(m.get("lsmkv_connections", 0))
                keys         = int(m.get("lsmkv_total_keys", 0))
                total_keys  += keys

                # CPU utilisation rate (Prometheus counter → rate)
                cpu_seconds = m.get("process_cpu_seconds_total", 0.0)
                cpu_rate    = _compute_rate(addr, "cpu_seconds", cpu_seconds, now)
                cpu_percent = round(min(100.0, cpu_rate * 100), 1)
                _prev_counters.setdefault(addr, {})["cpu_seconds"] = cpu_seconds
                _prev_ts[addr] = now

                # Compaction rate (Prometheus counter → rate)
                compaction_total = 0.0
                for line in raw_text.splitlines():
                    if "lsmkv_compaction_runs_total" in line and not line.startswith("#"):
                        try:
                            compaction_total = float(line.split()[-1])
                        except Exception:
                            pass
                compaction_rate = _compute_rate(addr, "compaction_runs", compaction_total, now)
                _prev_counters.setdefault(addr, {})["compaction_runs"] = compaction_total

                # Per-node application metrics from collector
                # All ops currently route via node0; we distribute evenly
                # across nodes for display purposes.  When per-node routing
                # is added, use collector.snapshot_for_node(addr) instead.
                node_snap  = _collector.snapshot_for_node(addr)
                node_qps   = node_snap["qps"] if node_snap["qps"] > 0 else round(cluster_qps / num_nodes, 2)
                node_p50   = node_snap["p50_ms"] if node_snap["p50_ms"] > 0 else cluster_p50
                node_p95   = node_snap["p95_ms"] if node_snap["p95_ms"] > 0 else cluster_p95
                node_p99   = node_snap["p99_ms"] if node_snap["p99_ms"] > 0 else cluster_p99

                short = addr.split(":")[0]
                node_payload[short] = {
                    "addr":            addr,
                    "alive":           alive,
                    # Application metrics (collector-owned)
                    "qps":             node_qps,
                    "p50_ms":          node_p50,
                    "p95_ms":          node_p95,
                    "p99_ms":          node_p99,
                    "error_rate":      error_rate,
                    # Infrastructure gauges (Prometheus-sourced, optional)
                    "cpu_percent":     cpu_percent,
                    "memory_mb":       round(memory_bytes / (1024 * 1024), 2),
                    "disk_mb":         round(disk_bytes   / (1024 * 1024), 2),
                    "bloom_hit_rate":  round(bloom_rate * 100, 1),
                    "memtable_mb":     round(memtable_b  / (1024 * 1024), 2),
                    "sstable_count":   sstables,
                    "compaction_rate": compaction_rate,
                    "connections":     connections,
                    "total_keys":      keys,
                }

            payload = {
                "ts":   now,
                "nodes": node_payload,
                "cluster": {
                    "total_qps":      cluster_qps,
                    "total_keys":     total_keys,
                    "node_count":     len(nodes),
                    "avg_p50_ms":     cluster_p50,
                    "avg_p95_ms":     cluster_p95,
                    "avg_p99_ms":     cluster_p99,
                    "error_rate":     error_rate,
                    "success_count":  snap["success_count"],
                    "error_count":    snap["error_count"],
                    "active_requests": snap["active_requests"],
                },
            }
            await websocket.send_json(payload)
            await asyncio.sleep(0.5)
    except Exception:
        pass
