/**
 * useMetricsWS — WebSocket hook for real Prometheus telemetry.
 *
 * Connects to ws://localhost:8000/ws/metrics which now pushes computed
 * rates (writes/s, reads/s), histogram quantiles (P50/P95/P99), CPU
 * utilization, memory, disk, bloom hit rate — all derived from real
 * Prometheus /metrics scrapes. No Math.random().
 */
import { useState, useEffect, useRef, useCallback } from "react";

// Per-node computed metrics (from backend rate+histogram computation)
export interface NodeMetrics {
  addr: string;
  alive: boolean;
  qps: number;              // writes/s + reads/s
  writes_per_sec: number;
  reads_per_sec: number;
  p50_ms: number;           // latency P50 from histogram
  p95_ms: number;
  p99_ms: number;
  cpu_percent: number;      // process_cpu_seconds_total rate * 100
  memory_mb: number;        // process_resident_memory_bytes
  disk_mb: number;          // lsmkv_disk_usage_bytes
  bloom_hit_rate: number;   // lsmkv_bloom_filter_hit_rate (0-100%)
  memtable_mb: number;      // lsmkv_memtable_size_bytes
  sstable_count: number;
  compaction_rate: number;
  connections: number;
  total_keys: number;
}

export interface ClusterMetrics {
  total_qps: number;
  total_keys: number;
  node_count: number;
  avg_p50_ms: number;
  avg_p99_ms: number;
}

export interface MetricsWSState {
  connected: boolean;
  /** Map of short node name ("node0") -> NodeMetrics */
  nodes: Map<string, NodeMetrics>;
  cluster: ClusterMetrics | null;
  lastTs: number | null;
}

// Derive WS URL so the code works in all three environments:
//  1. Local dev  (Vite proxy)          → ws://localhost:5173/ws/metrics
//  2. Full-stack (Railway/Render/local) → ws://same-host/ws/metrics
//  3. Split mode (Vercel + Railway API) → wss://railway-backend.up.railway.app/ws/metrics
function _wsUrl(): string {
  const externalApi = (import.meta.env.VITE_API_URL as string | undefined);
  if (externalApi) {
    // Convert https://host → wss://host   or   http://host → ws://host
    return externalApi.replace(/^http/, "ws") + "/ws/metrics";
  }
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/ws/metrics`;
}


const RECONNECT_DELAY_MS = 3000;

const EMPTY_STATE: MetricsWSState = {
  connected: false,
  nodes: new Map(),
  cluster: null,
  lastTs: null,
};

export function useMetricsWS(): MetricsWSState {
  const [state, setState] = useState<MetricsWSState>(EMPTY_STATE);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState < 2) return;
    try {
      const ws = new WebSocket(_wsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        setState((prev) => ({ ...prev, connected: true }));
      };

      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data) as {
            ts: number;
            nodes: Record<string, NodeMetrics>;
            cluster: ClusterMetrics;
          };
          const nodesMap = new Map<string, NodeMetrics>();
          for (const [name, m] of Object.entries(data.nodes ?? {})) {
            nodesMap.set(name, m);
          }
          setState({
            connected: true,
            nodes: nodesMap,
            cluster: data.cluster ?? null,
            lastTs: data.ts ?? null,
          });
        } catch { /* ignore parse errors */ }
      };

      ws.onerror = () => ws.close();

      ws.onclose = () => {
        wsRef.current = null;
        setState((prev) => ({ ...prev, connected: false }));
        reconnectRef.current = setTimeout(connect, RECONNECT_DELAY_MS);
      };
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, [connect]);

  return state;
}

/** Aggregate a metric across all nodes */
export function sumNodeMetric(nodes: Map<string, NodeMetrics>, key: keyof NodeMetrics): number {
  let total = 0;
  for (const n of nodes.values()) {
    const v = n[key];
    if (typeof v === "number") total += v;
  }
  return total;
}

/** Average a metric across alive nodes */
export function avgNodeMetric(nodes: Map<string, NodeMetrics>, key: keyof NodeMetrics): number {
  const alive = [...nodes.values()].filter((n) => n.alive);
  if (!alive.length) return 0;
  return alive.reduce((s, n) => {
    const v = n[key];
    return s + (typeof v === "number" ? v : 0);
  }, 0) / alive.length;
}
