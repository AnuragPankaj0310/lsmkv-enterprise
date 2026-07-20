import type { RingNode, RingKey } from "../../types/hashRing";

import { resolveOwnerIndex } from "../../utils/ringGeometry";
import { useCluster } from "../../context/ClusterContext";


export interface StatsProps {
  nodes: RingNode[];
  keys: RingKey[];
  replicationFactor?: number;
  virtualNodes?: number;
}

export default function Stats({ nodes, keys, replicationFactor, virtualNodes }: StatsProps) {
  const { nodes: runtimeNodes } = useCluster();
  const rf = replicationFactor ?? Math.min(2, nodes.length - 1);

  // Only include alive nodes in key ownership computation
  const aliveNodes = nodes.filter((n) => {
    const r = runtimeNodes.find((rt) => rt.id === n.id - 1); // ring=1-idx, ctx=0-idx
    return !r || r.state !== "UNREACHABLE";
  });

  // Per-node key distribution using alive-only ring
  const distribution = nodes.map((node) => {
    const r = runtimeNodes.find((rt) => rt.id === node.id - 1);
    const isDown = r?.state === "UNREACHABLE";
    return {
      node,
      isDown,
      count: isDown ? 0 : keys.filter((k) => resolveOwnerIndex(k, aliveNodes) === node.id).length,
    };
  });
  const maxCount = Math.max(...distribution.map((d) => d.count), 1);

  // Standard deviation
  const avg = keys.length / Math.max(nodes.length, 1);
  const stdDev = Math.sqrt(
    distribution.reduce((sum, d) => sum + Math.pow(d.count - avg, 2), 0) /
      Math.max(nodes.length, 1)
  ).toFixed(1);

  return (
    <div className="space-y-4">

      {/* Top 4 stat cards */}
      <div className="grid grid-cols-4 gap-4">

        {/* Nodes */}
        <div className="rounded-xl bg-zinc-900 p-5">
          <p className="text-xs text-zinc-500 uppercase tracking-wider">🖥 Nodes</p>
          <h2 className="mt-2 text-3xl font-bold">{nodes.length}</h2>
          <p className="mt-1 text-xs text-green-400 font-medium">
            {nodes.length} / {nodes.length} Healthy
          </p>
        </div>

        {/* Keys */}
        <div className="rounded-xl bg-zinc-900 p-5">
          <p className="text-xs text-zinc-500 uppercase tracking-wider">🗄 Keys</p>
          <h2 className="mt-2 text-3xl font-bold">{keys.length}</h2>
          <p className="mt-1 text-xs text-zinc-500">
            ~{Math.round(avg)} per node
          </p>
        </div>

        {/* Replication */}
        <div className="rounded-xl bg-zinc-900 p-5">
          <p className="text-xs text-zinc-500 uppercase tracking-wider">🛡 Replication</p>
          <h2 className="mt-2 text-3xl font-bold">RF = {rf}</h2>
          <p className="mt-1 text-xs text-zinc-500">
            {rf} replica{rf !== 1 ? "s" : ""} per key
          </p>
        </div>

        {/* Load Balance */}
        <div className="rounded-xl bg-zinc-900 p-5">
          <p className="text-xs text-zinc-500 uppercase tracking-wider">⚖ Load Balance</p>
          <div className="mt-2 flex items-end gap-2">
            {distribution.map((d) => (
              <span key={d.node.id} className="text-2xl font-bold">
                {d.count}
              </span>
            ))}
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            Std Dev {stdDev}
          </p>
        </div>

      </div>

      {/* Load distribution bars */}
      <div className="rounded-xl bg-zinc-900 p-5 space-y-3">
        <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">
          Key Distribution
        </p>
        {distribution.map((d) => {
          const label = d.node.addr
            ? d.node.addr.split(":")[0]
            : `Node-${d.node.id}`;
          const pct = d.isDown ? 0 : Math.round((d.count / maxCount) * 100);

          const colorMap: Record<number, string> = {
            1: "bg-blue-400",
            2: "bg-green-400",
            3: "bg-yellow-400",
            4: "bg-pink-400",
            5: "bg-orange-400",
            6: "bg-cyan-400",
          };

          return (
            <div key={d.node.id} className={`flex items-center gap-3 ${d.isDown ? "opacity-40" : ""}`}>
              <span className={`w-14 shrink-0 text-xs font-mono ${d.isDown ? "text-red-400" : "text-zinc-300"}`}>
                {label}
              </span>
              <div className="flex-1 h-2 rounded-full bg-zinc-800">
                <div
                  className={`h-2 rounded-full transition-all duration-700 ${d.isDown ? "bg-red-800" : colorMap[d.node.id]}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className={`w-8 shrink-0 text-right text-xs ${d.isDown ? "text-red-400" : "text-zinc-400"}`}>
                {d.isDown ? "—" : d.count}
              </span>
            </div>
          );
        })}

      </div>

      {/* Virtual nodes — only shown when backend is live */}
      {virtualNodes !== undefined && (
        <div className="rounded-xl bg-zinc-900 px-5 py-3 flex items-center justify-between">
          <p className="text-xs text-zinc-500 uppercase tracking-wider">Virtual Nodes</p>
          <span className="text-2xl font-bold">{virtualNodes}</span>
        </div>
      )}

    </div>
  );
}
