import { useState, useEffect, useMemo } from "react";
import SectionHeader from "../components/SectionHeader";
import { useCluster } from "../context/ClusterContext";
import type { ReplicationStatus } from "../api/live";
import { PacketFlow } from "../components/replication/PacketFlow";
import { ReplicaStatus } from "../components/replication/ReplicaStatus";
import { useClusterStore } from "../store/clusterStore";
import LiveBadge from "../components/LiveBadge";



export default function Replication() {
  const { nodes: runtimeNodes, partitions } = useCluster();

  // Build fallback based on current runtimeNodes — re-memoized when nodes change
  const buildFallback = useMemo((): ReplicationStatus => ({
    replication_factor: 2,
    quorum: 2,
    nodes: runtimeNodes.map((n, i) => ({
      id: n.id,
      name: `node${n.id}`,
      addr: `node${n.id}:${7001 + n.id}`,
      role: i === 0 ? "primary" : "replica",
      lag_ms: i === 0 ? 0 : 1.2 + i * 0.9,
      synced: true,
    })),
  }), [runtimeNodes]);

  const [data, setData] = useState<ReplicationStatus>(buildFallback);
  const [lagValues, setLagValues] = useState<number[]>(() => runtimeNodes.map((_, i) => i === 0 ? 0 : 1.2 + i * 0.9));
  const [backendOnline, setBackendOnline] = useState(true);

  // Read replication data from global store (set by syncEngine)
  const storeReplication = useClusterStore(s => s.replicationData);

  // Sync from store whenever it updates
  useEffect(() => {
    if (storeReplication) {
      setData(storeReplication);
      setBackendOnline(true);
    }
  }, [storeReplication]);

  // When runtimeNodes grows (new node added) but backend hasn't responded yet,
  // extend the data.nodes so the new node shows up immediately
  useEffect(() => {
    if (runtimeNodes.length > data.nodes.length) {
      setData((prev) => ({
        ...prev,
        nodes: runtimeNodes.map((n, i) => {
          const existing = prev.nodes.find((pn) => pn.id === n.id);
          return existing ?? {
            id: n.id,
            name: `node${n.id}`,
            addr: `node${n.id}:${7001 + n.id}`,
            role: i === 0 ? "primary" : "replica",
            lag_ms: 1.2 + i * 0.9,
            synced: true,
          };
        }),
      }));
    }
  }, [runtimeNodes.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // (removed local polling — syncEngine handles replication refresh)

  // Overlay chaos-engineering state onto lag values.
  // runtimeNodes state always wins — API lag is only used when node is HEALTHY.
  // Partitions between primary and replica also cause lag to spike.
  useEffect(() => {
    function computeLag() {
      setLagValues(
        data.nodes.map((n) => {
          // Primary never has lag
          if (n.role === "primary") return 0;

          // Find the matching runtime node (both 0-indexed)
          const runtime = runtimeNodes.find((r) => r.id === n.id);
          const s = runtime?.state ?? "HEALTHY";

          if (s === "UNREACHABLE") return 9999;           // displayed as ∞
          if (s === "SUSPECT")     return +(n.lag_ms * 12 + Math.random() * 25).toFixed(1);
          if (s === "REBALANCING") return +(n.lag_ms * 5 + Math.random() * 5).toFixed(1);
          if (s === "RECOVERING")  return +(n.lag_ms * 2).toFixed(1);

          // Network partition between primary (id=0) and this replica
          const primaryId = 0;
          const partitioned = partitions.some(
            (p) => (p.from === primaryId && p.to === n.id) || (p.from === n.id && p.to === primaryId)
          );
          if (partitioned) {
            // Lag grows exponentially over time — use sinusoidal escalation
            const escalated = n.lag_ms * (50 + Math.sin(Date.now() / 3000) * 30 + Math.random() * 40);
            return +Math.min(escalated, 9999).toFixed(1);
          }

          // HEALTHY — small jitter around API value
          return +(n.lag_ms + (Math.random() - 0.5) * 0.4).toFixed(2);
        })
      );
    }

    computeLag(); // run immediately on state change
    const t = setInterval(computeLag, 1200);
    return () => clearInterval(t);
  }, [data, runtimeNodes, partitions]); // re-runs whenever chaos state or partitions change



  const downCount = runtimeNodes.filter((n) => n.state === "UNREACHABLE" || n.state === "REBALANCING").length;
  const quorumLost = downCount >= data.quorum;
  const rf = data.replication_factor;
  const maxLag = Math.max(...lagValues.filter((v) => v < 9000));

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <SectionHeader
          title="Replication"
          subtitle={`RF = ${rf} — writes replicated to ${rf} nodes, quorum = ${data.quorum} | ${backendOnline ? "🟢 Live" : "🟡 Fallback"}`}
        />
        <div className="flex items-center gap-3 mt-1 shrink-0">
          <LiveBadge refreshLabel="5 sec" />
          <span className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold tracking-widest ${
            quorumLost
              ? "border-red-700 bg-red-950/50 text-red-400"
              : partitions.length > 0
              ? "border-yellow-700 bg-yellow-950/50 text-yellow-400"
              : "border-green-700 bg-green-950/80 text-green-400"
          }`}>
            <span className="h-2.5 w-2.5 rounded-full" style={{
              backgroundColor: quorumLost ? "#f87171" : partitions.length > 0 ? "#facc15" : "#4ade80",
              animation: "pulse 2s infinite",
            }} />
            {quorumLost ? "QUORUM LOST" : partitions.length > 0 ? "DEGRADED" : "IN SYNC"}
          </span>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { icon: "🛡", label: "Replication Factor", value: `RF = ${rf}` },
          { icon: "⚖️", label: "Quorum",              value: `W=${data.quorum} / R=${data.quorum}` },
          { icon: "✅", label: "In Sync",              value: `${data.nodes.length - downCount} / ${data.nodes.length}` },
          { icon: "⏱", label: "Max Lag",               value: lagValues.some((v) => v >= 9000) ? "∞" : `${maxLag.toFixed(1)} ms` },
        ].map((s) => (
          <div key={s.label} className="rounded-xl bg-zinc-900 p-5">
            <p className="text-xs text-zinc-500 uppercase tracking-wider">{s.icon} {s.label}</p>
            <h2 className="mt-2 text-2xl font-bold">{s.value}</h2>
          </div>
        ))}
      </div>

      {/* Quorum lost alert */}
      {quorumLost && (
        <div className="rounded-xl border border-red-800 bg-red-950/30 px-5 py-4 flex items-center gap-3">
          <span className="text-2xl">⚠️</span>
          <div>
            <p className="font-bold text-red-400">Quorum Lost — Writes are blocked</p>
            <p className="text-xs text-red-600 mt-0.5">Recover nodes in Chaos Engineering to resume normal operation.</p>
          </div>
        </div>
      )}

      {/* Flow + Quorum ring */}
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 rounded-xl bg-zinc-900 p-5">
          <p className="text-xs text-zinc-500 uppercase tracking-wider mb-4">📡 Live Replication Flow</p>
          <PacketFlow nodeNames={data.nodes.map((n) => n.name)} />
        </div>

        <div className="rounded-xl bg-zinc-900 p-5 flex flex-col items-center justify-center gap-4">
          <p className="text-xs text-zinc-500 uppercase tracking-wider self-start">🔵 Quorum Status</p>
          <svg width={200} height={200}>
            <circle cx={100} cy={100} r={70} fill="none" stroke="#27272a" strokeWidth={18} />
            <circle cx={100} cy={100} r={70} fill="none"
              stroke={quorumLost ? "#f87171" : "#4ade80"}
              strokeWidth={18}
              strokeDasharray={`${((data.nodes.length - downCount) / data.nodes.length) * 2 * Math.PI * 70} ${2 * Math.PI * 70}`}
              strokeLinecap="round" transform="rotate(-90 100 100)"
              style={{ transition: "all 0.7s" }}
            />
            <text x={100} y={95} textAnchor="middle" fill="white" fontSize={20} fontWeight="bold">RF={rf}</text>
            <text x={100} y={115} textAnchor="middle" fill="#71717a" fontSize={10}>
              {data.nodes.length - downCount}/{data.nodes.length} online
            </text>
          </svg>
          <p className="text-xs text-zinc-400 text-center">
            Writes require <strong className="text-white">{data.quorum}</strong> acknowledgements
          </p>
        </div>
      </div>

      {/* Per-node status using extracted component */}
      <ReplicaStatus data={data} lagValues={lagValues} />
    </div>
  );
}