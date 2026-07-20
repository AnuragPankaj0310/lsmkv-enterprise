"""
dashboard/api/metrics/collector.py

MetricsCollector — the single source of truth for application-level
metrics served to the React dashboard.

Design
------
* The collector is completely independent of Prometheus.
* It records every KV operation the FastAPI backend sends to the cluster.
* snapshot() computes QPS, percentile latencies, and error rates from
  a rolling 60-second window — with no external scraping required.
* Prometheus may still scrape lsmkv nodes for SRE dashboards, but the
  React UI never depends on Prometheus being available.

Thread-safety
-------------
RollingWindow uses an internal Lock; active_requests uses
threading.Lock as well, so the collector is safe for uvicorn
multi-threaded/async usage.
"""
from __future__ import annotations

import threading
import time

from .models import OpRecord
from .rolling_window import RollingWindow


class MetricsCollector:
    """
    Records KV operations and computes aggregated metrics on demand.

    Usage
    -----
    collector = MetricsCollector()

    # In every _kv_set / _kv_get / _kv_delete wrapper:
    collector.record("SET", latency_ms=4.2, ok=True, node="node0:7001")

    # In ws_metrics loop:
    snap = collector.snapshot()
    # snap = {
    #   "qps": 12.4,
    #   "p50_ms": 3.1, "p95_ms": 7.8, "p99_ms": 14.2,
    #   "error_rate": 0.01,
    #   "success_count": 1230,
    #   "error_count": 12,
    #   "active_requests": 3,
    # }
    """

    def __init__(
        self,
        window_seconds: float = 60.0,
        maxsize: int = 12_000,
    ) -> None:
        self._window = RollingWindow(maxsize=maxsize, window_seconds=window_seconds)
        self._active: int = 0
        self._active_lock = threading.Lock()
        # All-time totals (monotonically increasing)
        self._total_success: int = 0
        self._total_errors: int = 0
        self._total_lock = threading.Lock()

    # ------------------------------------------------------------------
    # Recording
    # ------------------------------------------------------------------

    def record(
        self,
        cmd: str,
        latency_ms: float,
        ok: bool,
        node: str = "unknown",
    ) -> None:
        """
        Record one completed operation.

        Parameters
        ----------
        cmd         : "SET" | "GET" | "DEL"
        latency_ms  : round-trip time in milliseconds
        ok          : True = success response, False = error / timeout
        node        : node address that handled the request
        """
        record = OpRecord(
            ts=time.monotonic(),
            wall_ts=time.time(),
            cmd=cmd,
            latency_ms=latency_ms,
            ok=ok,
            node=node,
        )
        self._window.append(record)
        with self._total_lock:
            if ok:
                self._total_success += 1
            else:
                self._total_errors += 1

    def inc_active(self) -> None:
        """Call before sending a request to the cluster."""
        with self._active_lock:
            self._active += 1

    def dec_active(self) -> None:
        """Call after the cluster responds (even on error)."""
        with self._active_lock:
            self._active = max(0, self._active - 1)

    # ------------------------------------------------------------------
    # Aggregation
    # ------------------------------------------------------------------

    def snapshot(self, window_seconds: float | None = None) -> dict:
        """
        Compute and return a metrics snapshot for the given window
        (default: the window configured at construction, usually 60 s).

        Returns
        -------
        dict with keys:
            qps             – operations per second
            p50_ms          – 50th percentile latency (ms)
            p95_ms          – 95th percentile latency (ms)
            p99_ms          – 99th percentile latency (ms)
            error_rate      – fraction of errors in the window (0–1)
            success_count   – all-time success count
            error_count     – all-time error count
            active_requests – currently in-flight requests
        """
        records = self._window.within(window_seconds)
        n = len(records)

        with self._active_lock:
            active = self._active
        with self._total_lock:
            total_success = self._total_success
            total_errors = self._total_errors

        if n == 0:
            return {
                "qps": 0.0,
                "p50_ms": 0.0,
                "p95_ms": 0.0,
                "p99_ms": 0.0,
                "error_rate": 0.0,
                "success_count": total_success,
                "error_count": total_errors,
                "active_requests": active,
            }

        # QPS — ops within the window divided by the actual elapsed span
        oldest = records[0].ts
        newest = records[-1].ts
        elapsed = max(newest - oldest, 0.001)  # avoid divide-by-zero
        # Use min(elapsed, window) so a burst doesn't inflate QPS
        w = window_seconds if window_seconds is not None else self._window._window
        qps = round(n / min(elapsed, w), 2)

        # Percentile latencies — only from SUCCESSFUL operations.
        # Failed / timed-out ops have latency ≈ timeout (2000 ms) which
        # would completely skew the histogram; count them in error_rate only.
        latencies = sorted(r.latency_ms for r in records if r.ok)

        def _pct(p: float) -> float:
            if not latencies:
                return 0.0
            idx = int(p * len(latencies))
            idx = min(idx, len(latencies) - 1)
            return round(latencies[idx], 2)

        # Error rate
        errors = sum(1 for r in records if not r.ok)
        error_rate = round(errors / n, 4)

        return {
            "qps": qps,
            "p50_ms": _pct(0.50),
            "p95_ms": _pct(0.95),
            "p99_ms": _pct(0.99),
            "error_rate": error_rate,
            "success_count": total_success,
            "error_count": total_errors,
            "active_requests": active,
        }

    def snapshot_for_node(self, node: str, window_seconds: float | None = None) -> dict:
        """
        Same as snapshot() but filtered to a single node address.
        Useful when the backend routes different keys to different nodes.
        """
        records = [r for r in self._window.within(window_seconds) if r.node == node]
        n = len(records)
        if n == 0:
            return {"qps": 0.0, "p50_ms": 0.0, "p95_ms": 0.0, "p99_ms": 0.0, "error_rate": 0.0}

        oldest = records[0].ts
        newest = records[-1].ts
        elapsed = max(newest - oldest, 0.001)
        w = window_seconds if window_seconds is not None else self._window._window
        qps = round(n / min(elapsed, w), 2)
        # Only successful ops contribute to latency percentiles
        latencies = sorted(r.latency_ms for r in records if r.ok)

        def _pct(p: float) -> float:
            if not latencies:
                return 0.0
            idx = min(int(p * len(latencies)), len(latencies) - 1)
            return round(latencies[idx], 2)

        errors = sum(1 for r in records if not r.ok)
        return {
            "qps": qps,
            "p50_ms": _pct(0.50),
            "p95_ms": _pct(0.95),
            "p99_ms": _pct(0.99),
            "error_rate": round(errors / n, 4),
        }
