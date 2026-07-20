import type { ReplicationStatus } from "../../api/live";
import { useCluster } from "../../context/ClusterContext";

interface LagBarProps { ms: number; hex: string; infinite?: boolean }
export function LagBar({ ms, hex, infinite }: LagBarProps) {
  const pct = infinite ? 100 : Math.min((ms / 10) * 100, 100);
  return (
    <div className="h-1.5 rounded-full bg-zinc-800 w-full">
      <div
        className="h-1.5 rounded-full transition-all duration-500"
        style={{ width: `${pct}%`, backgroundColor: infinite ? "#f87171" : hex }}
      />
    </div>
  );
}

const NODE_HEX = ["#60a5fa", "#4ade80", "#facc15", "#c084fc", "#f472b6", "#2dd4bf"];

interface ReplicaStatusProps {
  data: ReplicationStatus;
  lagValues: number[];
}

export function ReplicaStatus({ data, lagValues }: ReplicaStatusProps) {
  // runtimeNodes are 0-indexed; replication API nodes are also 0-indexed
  const { nodes: runtimeNodes } = useCluster();

  return (
    <div className="rounded-xl bg-zinc-900 p-5 space-y-4">
      <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2">Per-Node Replication Status</p>
      {data.nodes.map((n, i) => {
        const runtime = runtimeNodes.find((r) => r.id === n.id); // both 0-indexed ✓
        const isDown     = runtime?.state === "UNREACHABLE";
        const isSuspect  = runtime?.state === "SUSPECT";
        const isRebal    = runtime?.state === "REBALANCING";
        const isRecover  = runtime?.state === "RECOVERING";

        const lag = lagValues[i] ?? n.lag_ms;
        const synced = !isDown && !isSuspect && lag < 5;
        // Use n.id for color (not loop index) so node3, node4 get distinct colors
        const hex = NODE_HEX[n.id] ?? NODE_HEX[i % NODE_HEX.length] ?? "#a1a1aa";

        const stateLabel = isDown
          ? "✗ Down"
          : isSuspect
          ? "⚠ Suspect"
          : isRebal
          ? "↻ Rebalancing"
          : isRecover
          ? "↑ Recovering"
          : synced
          ? "✓ Synced"
          : "⚠ Lagging";

        const stateColor = isDown
          ? "text-red-400"
          : isSuspect
          ? "text-yellow-400"
          : isRebal
          ? "text-purple-400"
          : isRecover
          ? "text-blue-400"
          : synced
          ? "text-green-400"
          : "text-orange-400";

        return (
          <div key={n.id} className="flex items-center gap-4">
            <div className="flex items-center gap-2 w-28">
              <span className="h-3 w-3 rounded-full" style={{ backgroundColor: isDown ? "#52525b" : hex }} />
              <span className="text-sm font-mono text-zinc-300">{n.name}</span>
            </div>

            <span className={`w-16 text-center rounded-full text-[10px] font-bold px-2 py-0.5 ${
              n.role === "primary"
                ? "bg-blue-900/60 text-blue-300 border border-blue-700"
                : "bg-zinc-800 text-zinc-400 border border-zinc-700"
            }`}>
              {n.role === "primary" ? "PRIMARY" : "REPLICA"}
            </span>

            <div className="flex-1 space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-zinc-500">Replication lag</span>
                <span className={`font-mono ${isDown ? "text-red-400" : isSuspect ? "text-yellow-400" : "text-zinc-300"}`}>
                  {n.role === "primary" ? "—" : isDown ? "∞" : `${lag.toFixed(1)} ms`}
                </span>
              </div>
              {n.role !== "primary" && (
                <LagBar ms={lag} hex={hex} infinite={isDown} />
              )}
            </div>

            <span className={`text-xs font-bold w-24 text-right ${stateColor}`}>
              {stateLabel}
            </span>
          </div>
        );
      })}
    </div>
  );
}
