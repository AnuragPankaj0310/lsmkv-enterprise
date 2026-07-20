import { apiFetch } from "./client";

export interface MetricsSnapshot {
  qps: number;
  latency_p50_ms: number;
  latency_p99_ms: number;
  cpu_percent: number;
  disk_usage_mb: number;
  cache_hit_rate: number;
  bloom_fp_rate: number;
  compaction_runs: number;
  replication_lag_ms: number;
  memtable_size_bytes: number;
  sstable_count: number;
  write_amplification: number;
  read_amplification: number;
  timestamp: number;
}

/** GET /metrics — operational metrics for the Metrics page */
export async function getMetrics(): Promise<MetricsSnapshot> {
  return apiFetch<MetricsSnapshot>("/api/metrics");
}
