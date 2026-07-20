/**
 * Metrics — Real-time performance page.
 *
 * ALL values come from Prometheus via WebSocket /ws/metrics.
 * Zero Math.random(). Zero polling. Zero fake numbers.
 * Load generator lives on the Dashboard page.
 *
 * Architecture:
 *   Prometheus /metrics (per node)
 *     → FastAPI /ws/metrics (scrape + histogram quantiles)
 *     → useMetricsWS hook
 *     → This page (sparklines + big numbers)
 */
import { useEffect, useRef } from "react";
import SectionHeader from "../components/SectionHeader";
import { useCluster } from "../context/ClusterContext";
import { COLOR_HEX } from "../utils/ringConstants";
import { useMetricsWS, sumNodeMetric, avgNodeMetric } from "../hooks/useMetricsWS";
import LiveBadge from "../components/LiveBadge";

const HISTORY_LEN = 30;

// ── Sparkline ─────────────────────────────────────────────────────────────────
function Sparkline({ data, color = "#60a5fa", fill = false }: {
  data: number[]; color?: string; fill?: boolean;
}) {
  const h = 48, w = 140;
  const max = Math.max(...data, 0.001);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const pts = data
    .map((v, i) => `${(i / Math.max(data.length - 1, 1)) * w},${h - ((v - min) / range) * (h - 4)}`)
    .join(" ");
  const fillPts = fill ? `${pts} ${w},${h} 0,${h}` : "";
  const last = data[data.length - 1] ?? 0;
  const lx = w;
  const ly = h - ((last - min) / range) * (h - 4);

  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} preserveAspectRatio="none" className="overflow-visible">
      {fill && <polygon points={fillPts} fill={color} opacity={0.08} />}
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {data.length > 0 && (
        <>
          <circle cx={lx} cy={ly} r={4} fill={color} opacity={0.3} />
          <circle cx={lx} cy={ly} r={2} fill={color} />
        </>
      )}
    </svg>
  );
}

// ── History accumulator hook ──────────────────────────────────────────────────
function useHistory(value: number | undefined, len = HISTORY_LEN): number[] {
  const histRef = useRef<number[]>(Array(len).fill(0));
  useEffect(() => {
    if (value === undefined || value === null) return;
    histRef.current = [...histRef.current.slice(1), value];
  });
  return histRef.current;
}

// ── Metric card ───────────────────────────────────────────────────────────────
function MetricCard({ icon, label, value, unit, data, color, sub, isLive, unavailable }: {
  icon: string; label: string; value: string; unit: string;
  data: number[]; color: string; sub?: string; isLive?: boolean; unavailable?: boolean;
}) {
  return (
    <div
      className="rounded-xl border border-zinc-800 bg-zinc-900/60 backdrop-blur p-4 flex flex-col gap-2 hover:border-zinc-700 transition-all"
      style={{ boxShadow: `0 0 20px ${color}10` }}
    >
      <div className="flex items-center justify-between">
        <span className="text-lg">{icon}</span>
        {isLive && !unavailable && (
          <span className="text-[9px] font-bold text-green-400 bg-green-950/40 border border-green-900/60 rounded-full px-1.5 py-0.5 tracking-widest">
            LIVE
          </span>
        )}
        {unavailable && (
          <span className="text-[9px] font-bold text-zinc-500 bg-zinc-900 border border-zinc-700 rounded-full px-1.5 py-0.5 tracking-widest">
            NOT EXPORTED
          </span>
        )}
      </div>
      <div className="flex items-end gap-1">
        <span
          className={`text-2xl font-black tabular-nums leading-none ${unavailable ? "text-zinc-600" : "text-white"}`}
          style={unavailable ? {} : { color }}
        >
          {value}
        </span>
        {!unavailable && unit && <span className="text-xs text-zinc-500 mb-0.5">{unit}</span>}
      </div>
      <div className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">{label}</div>
      {sub && <div className="text-[10px] text-zinc-600">{sub}</div>}
      <Sparkline data={unavailable ? Array(HISTORY_LEN).fill(0) : data} color={unavailable ? "#3f3f46" : color} fill />
    </div>
  );
}

// ── Per-node row ──────────────────────────────────────────────────────────────
function NodeRow({ name, metrics, color, state }: {
  name: string;
  metrics: { qps: number; p50_ms: number; p99_ms: number; cpu_percent: number; disk_mb: number; memory_mb: number; alive: boolean };
  color: string;
  state: string;
}) {
  const isDown = state === "UNREACHABLE";
  const isSuspect = state === "SUSPECT" || state === "REBALANCING";
  const statusColor = isDown ? "#f87171" : isSuspect ? "#facc15" : "#4ade80";
  const statusLabel = isDown ? "DOWN" : isSuspect ? state : "OK";

  return (
    <div className={`flex items-center gap-3 rounded-lg border px-4 py-3 transition-all ${
      isDown ? "border-red-900/60 bg-red-950/10" : "border-zinc-800 bg-zinc-900/30"
    }`}>
      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
      <span className="text-sm font-mono font-bold text-white w-16">{name}</span>
      <span
        className="text-[10px] font-bold rounded-full px-2 py-0.5 border tracking-widest w-24 text-center"
        style={{ color: statusColor, borderColor: statusColor + "40", backgroundColor: statusColor + "10" }}
      >
        {statusLabel}
      </span>
      {isDown ? (
        <span className="text-xs text-zinc-600 italic">— offline —</span>
      ) : (
        <div className="flex gap-6 text-xs tabular-nums text-zinc-300 font-mono ml-2 flex-1">
          <span>
            <span className="text-zinc-600">QPS </span>
            {metrics.qps > 0 ? metrics.qps.toFixed(1) : <span className="text-zinc-600 italic">Idle</span>}
          </span>
          <span>
            <span className="text-zinc-600">P50 </span>
            {metrics.p50_ms > 0 ? <>{metrics.p50_ms.toFixed(1)}<span className="text-zinc-600">ms</span></> : <span className="text-zinc-500">—</span>}
          </span>
          <span>
            <span className="text-zinc-600">P99 </span>
            {metrics.p99_ms > 0 ? <>{metrics.p99_ms.toFixed(1)}<span className="text-zinc-600">ms</span></> : <span className="text-zinc-500">—</span>}
          </span>
          <span title="process_cpu_seconds_total rate × 100">
            <span className="text-zinc-600">CPU </span>
            {metrics.cpu_percent > 0 ? <>{metrics.cpu_percent.toFixed(1)}<span className="text-zinc-600">%</span></> : <span className="text-zinc-500">—</span>}
          </span>
          <span title="process_resident_memory_bytes — may not be exported">
            <span className="text-zinc-600">MEM </span>
            {metrics.memory_mb > 0 ? <>{metrics.memory_mb.toFixed(0)}<span className="text-zinc-600">MB</span></> : <span className="text-zinc-500">—</span>}
          </span>
          <span>
            <span className="text-zinc-600">DISK </span>
            {metrics.disk_mb > 0 ? <>{metrics.disk_mb.toFixed(1)}<span className="text-zinc-600">MB</span></> : <span className="text-zinc-500">—</span>}
          </span>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function Metrics() {
  const { nodes: runtimeNodes, partitions } = useCluster();
  const ws = useMetricsWS();

  // Cluster-level aggregates from WS
  const totalQps    = ws.cluster?.total_qps  ?? sumNodeMetric(ws.nodes, "qps");
  const avgP50      = ws.cluster?.avg_p50_ms ?? avgNodeMetric(ws.nodes, "p50_ms");
  const avgP99      = ws.cluster?.avg_p99_ms ?? avgNodeMetric(ws.nodes, "p99_ms");
  const totalDiskMb = sumNodeMetric(ws.nodes, "disk_mb");
  const avgCpu      = avgNodeMetric(ws.nodes, "cpu_percent");
  const avgBloom    = avgNodeMetric(ws.nodes, "bloom_hit_rate");

  // Rolling histories for sparklines
  const qpsHist   = useHistory(totalQps);
  const p50Hist   = useHistory(avgP50);
  const p99Hist   = useHistory(avgP99);
  const cpuHist   = useHistory(avgCpu);
  const diskHist  = useHistory(totalDiskMb);
  const bloomHist = useHistory(avgBloom);

  // Alert state
  const downCount    = runtimeNodes.filter(n => n.state === "UNREACHABLE").length;
  const suspectCount = runtimeNodes.filter(n => n.state === "SUSPECT").length;
  const isAlert      = downCount > 0 || suspectCount > 0 || partitions.length > 0;
  const alertColor   = downCount > 0 ? "#f87171" : partitions.length > 0 ? "#fb923c" : "#facc15";
  const healthColor  = "#4ade80";

  const anyNodeAlive = [...ws.nodes.values()].some(n => n.alive);

  // Format helpers
  const fmtMs  = (v: number) => v > 0 ? `${v.toFixed(1)}` : "—";
  const fmtPct = (v: number) => v > 0 ? `${v.toFixed(1)}` : "—";
  const fmtQps = (v: number) => v > 0 ? `${Math.round(v)}` : "Idle";

  // CPU unavailable when process_cpu_seconds_total not exported
  const cpuUnavailable = !anyNodeAlive || avgCpu === 0;

  const cards = [
    {
      icon: "⚡", label: "Throughput (QPS)",
      value: fmtQps(totalQps), unit: totalQps > 0 ? "req/s" : "",
      data: qpsHist, color: isAlert ? alertColor : "#60a5fa",
      sub: ws.connected ? `writes/s + reads/s across ${runtimeNodes.length} nodes` : "backend offline",
      unavailable: false,
    },
    {
      icon: "⏱", label: "Latency P50",
      value: fmtMs(avgP50), unit: avgP50 > 0 ? "ms" : "",
      data: p50Hist, color: isAlert ? "#fb923c" : healthColor,
      sub: avgP50 > 0 ? "Histogram median across all nodes" : "Waiting for requests…",
      unavailable: false,
    },
    {
      icon: "🔴", label: "Latency P99",
      value: fmtMs(avgP99), unit: avgP99 > 0 ? "ms" : "",
      data: p99Hist, color: "#f472b6",
      sub: avgP99 > 0 ? "Histogram 99th pctile — worst-case" : "Waiting for requests…",
      unavailable: false,
    },
    {
      icon: "🖥", label: "CPU Utilization",
      value: cpuUnavailable ? "—" : fmtPct(avgCpu), unit: cpuUnavailable ? "" : "%",
      data: cpuHist, color: isAlert ? alertColor : "#facc15",
      sub: cpuUnavailable ? "process_cpu_seconds_total — not exported" : "process_cpu_seconds_total rate × 100",
      unavailable: cpuUnavailable,
    },
    {
      icon: "💿", label: "Total Disk Usage",
      value: totalDiskMb > 0 ? totalDiskMb.toFixed(1) : "—", unit: totalDiskMb > 0 ? "MB" : "",
      data: diskHist, color: "#fb923c",
      sub: "lsmkv_disk_usage_bytes across all nodes",
      unavailable: false,
    },
    {
      icon: "🌸", label: "Bloom Hit Rate",
      value: avgBloom > 0 ? `${avgBloom.toFixed(1)}` : "—", unit: avgBloom > 0 ? "%" : "",
      data: bloomHist, color: isAlert ? alertColor : "#22d3ee",
      sub: avgBloom > 0 ? "lsmkv_bloom_filter_hit_rate — SSTables skipped" : "Waiting for SSTable reads…",
      unavailable: false,
    },
  ];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <SectionHeader
          title="Metrics"
          subtitle={
            ws.connected
              ? `🟢 WebSocket connected — Prometheus telemetry, 500ms cadence`
              : `🔴 WebSocket offline — connect backend to see real data`
          }
        />
        <div className="flex items-center gap-3 mt-1 shrink-0">
          <LiveBadge mode="websocket" wsConnected={ws.connected} wsLastTs={ws.lastTs} refreshLabel="500ms" />
          <div className={`rounded-full px-3 py-1 text-xs font-bold border tracking-widest ${
            isAlert ? "text-red-400 border-red-800 bg-red-950/20" : "text-green-400 border-green-900 bg-green-950/20"
          }`}>
            {isAlert ? `⚠ DEGRADED — ${downCount} node(s) down` : "✓ CLUSTER HEALTHY"}
          </div>
        </div>
      </div>

      {/* 6-card grid */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map(c => (
          <MetricCard key={c.label} {...c} isLive={ws.connected && anyNodeAlive} />
        ))}
      </div>

      {/* Per-node table */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-2">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-zinc-300 uppercase tracking-wider">Per-Node Telemetry</h3>
          <span className="text-[10px] text-zinc-600 font-mono">
            {ws.connected && anyNodeAlive ? "live — from Prometheus" : ws.connected ? "connected — nodes offline" : "backend offline"}
          </span>
        </div>
        <div className="space-y-1.5">
          {runtimeNodes.map((n, i) => {
            // addr prefix ("node0","node1",…) matches ws.nodes Map keys from backend.
            // Guard against addr being undefined during initial load.
            const shortName = n.name ?? `node${n.id - 1}`;
            const m = ws.nodes.get(shortName);
            const color = COLOR_HEX[(i % 6) + 1] ?? "#60a5fa";
            return (
              <NodeRow
                key={n.id}
                name={shortName}
                state={n.state}
                color={color}
                metrics={{
                  qps:         m?.qps         ?? 0,
                  p50_ms:      m?.p50_ms      ?? 0,
                  p99_ms:      m?.p99_ms      ?? 0,
                  cpu_percent: m?.cpu_percent ?? 0,
                  disk_mb:     m?.disk_mb     ?? 0,
                  memory_mb:   m?.memory_mb   ?? 0,
                  alive:       m?.alive       ?? false,
                }}
              />
            );
          })}
        </div>
      </div>

      {/* Latency histogram panel */}
      {anyNodeAlive && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <h3 className="text-sm font-bold text-zinc-300 uppercase tracking-widest mb-4">
            Latency Histogram — P50 / P95 / P99
          </h3>
          {[...ws.nodes.values()].every(n => n.p50_ms === 0 && n.p99_ms === 0) ? (
            <div className="text-center py-6 text-zinc-500 text-sm space-y-1">
              <div className="text-xl">⏳</div>
              <div>Waiting for requests — send traffic to populate histogram</div>
              <div className="text-xs text-zinc-600">Use Generate Load on the Dashboard to send traffic</div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {[...ws.nodes.entries()].map(([name, m]) => {
                if (!m.alive) return null;
                const nodeIdx = parseInt(name.replace("node", ""), 10);
                const color = COLOR_HEX[(nodeIdx % 6) + 1] ?? "#60a5fa";
                return (
                  <div key={name} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                      <span className="text-xs font-bold text-zinc-300 font-mono">{name}</span>
                    </div>
                    {(["p50_ms", "p95_ms", "p99_ms"] as const).map(k => {
                      const label = k === "p50_ms" ? "P50" : k === "p95_ms" ? "P95" : "P99";
                      const val = m[k];
                      const pct = Math.min(100, (val / 100) * 100);
                      const barColor = val > 50 ? "#f87171" : val > 20 ? "#fb923c" : color;
                      return (
                        <div key={k} className="space-y-1">
                          <div className="flex justify-between text-[11px]">
                            <span className="text-zinc-500 font-mono">{label}</span>
                            <span className="text-zinc-300 font-mono tabular-nums">
                              {val > 0 ? `${val.toFixed(2)}ms` : "—"}
                            </span>
                          </div>
                          <div className="h-1 w-full rounded-full bg-zinc-800">
                            <div className="h-1 rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: barColor }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Backend offline hint */}
      {!ws.connected && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/20 p-8 text-center text-zinc-600 space-y-2">
          <div className="text-2xl">📡</div>
          <div className="text-sm font-semibold">Backend offline</div>
          <div className="text-xs">Start the FastAPI server and lsmkv nodes to see real Prometheus metrics.</div>
          <code className="text-[10px] text-zinc-700 block mt-2">
            cd dashboard/api && uvicorn main:app --reload --port 8000
          </code>
        </div>
      )}
    </div>
  );
}