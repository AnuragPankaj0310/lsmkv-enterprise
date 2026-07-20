/**
 * Lightweight client-side metrics generator.
 * Produces realistic-looking values for pages that can't always reach the backend.
 * Used as fallback when GET /metrics is offline.
 */
import type { MetricsSnapshot } from "../types/metrics";

export function generateMetrics(base?: Partial<MetricsSnapshot>): MetricsSnapshot {
  const t = Date.now() / 1000;
  const tick = Math.sin(t / 10);
  return {
    qps:                base?.qps                ?? +(120 + tick * 30).toFixed(1),
    latency_p50_ms:     base?.latency_p50_ms     ?? +(0.8 + tick * 0.3).toFixed(2),
    latency_p99_ms:     base?.latency_p99_ms     ?? +(4.2 + tick * 1.1).toFixed(2),
    cpu_percent:        base?.cpu_percent         ?? +(22 + tick * 8).toFixed(1),
    disk_usage_mb:      base?.disk_usage_mb       ?? +(480 + tick * 20).toFixed(1),
    cache_hit_rate:     base?.cache_hit_rate      ?? +(0.87 + tick * 0.05).toFixed(3),
    bloom_fp_rate:      base?.bloom_fp_rate       ?? +(0.012 + tick * 0.003).toFixed(4),
    compaction_runs:    base?.compaction_runs     ?? 14,
    replication_lag_ms: base?.replication_lag_ms  ?? +(1.1 + tick * 0.4).toFixed(2),
    memtable_size_bytes:base?.memtable_size_bytes ?? 4_194_304,
    sstable_count:      base?.sstable_count       ?? 8,
    write_amplification:base?.write_amplification ?? +(3.2 + tick * 0.5).toFixed(2),
    read_amplification: base?.read_amplification  ?? +(1.8 + tick * 0.3).toFixed(2),
    timestamp: t,
  };
}

/** Jitter a numeric value slightly — useful for sparkline variation */
export function jitter(value: number, pct = 0.05): number {
  return +(value * (1 + (Math.random() - 0.5) * pct * 2)).toFixed(2);
}
