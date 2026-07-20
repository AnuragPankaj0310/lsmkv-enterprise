import { motion, AnimatePresence } from "framer-motion";
import type { NodeRuntimeState } from "../../types/failure";
import { STATE_COLORS, FAILURE_LABELS } from "../../types/failure";

const NODE_HEX = ["#60a5fa", "#4ade80", "#facc15", "#c084fc", "#f472b6", "#22d3ee"];

interface NodeStateCardProps {
  node: NodeRuntimeState;
  onKill: () => void;
  onRecover: () => void;
  isPartitionSource?: boolean;
}

function StatePulse({ state }: { state: NodeRuntimeState["state"] }) {
  const { dot } = STATE_COLORS[state];
  const shouldPulse = state !== "HEALTHY" && state !== "UNREACHABLE";
  return (
    <span
      className="inline-block h-2.5 w-2.5 rounded-full flex-shrink-0"
      style={{
        backgroundColor: dot,
        animation:
          state === "HEALTHY"
            ? "pulse 2.5s ease-in-out infinite"
            : state === "UNREACHABLE"
            ? "none"
            : shouldPulse
            ? "fastPulse 1s ease-in-out infinite"
            : undefined,
        opacity: state === "UNREACHABLE" ? 0.4 : 1,
      }}
    />
  );
}

export function NodeStateCard({ node, onKill, onRecover, isPartitionSource }: NodeStateCardProps) {
  const { text, bg, border } = STATE_COLORS[node.state];

  const isHealthy = node.state === "HEALTHY";
  const nodeColor = NODE_HEX[node.id] ?? "#a1a1aa";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-xl border p-5 space-y-4 transition-all duration-500 ${bg} ${border}`}
      style={{
        filter: node.state === "UNREACHABLE" ? "grayscale(0.5)" : "none",
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-full font-bold text-sm border border-white/20"
            style={{ backgroundColor: nodeColor + "30", color: nodeColor, borderColor: nodeColor + "60" }}
          >
            {node.id}
          </div>
          <div>
            <p className="font-semibold text-sm text-white">{node.name}</p>
            <p className="text-[10px] text-zinc-500 font-mono">localhost:{7001 + node.id}</p>
          </div>
        </div>

        {/* State badge */}
        <div className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold tracking-widest ${text} ${border} ${bg}`}>
          <StatePulse state={node.state} />
          {node.state}
        </div>
      </div>

      {/* Active failure badge */}
      <AnimatePresence>
        {node.activeFailure && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="rounded-lg border border-red-800 bg-red-950/40 px-3 py-2 text-xs text-red-400">
              ⚠ {FAILURE_LABELS[node.activeFailure.type]} injected
            </div>
          </motion.div>
        )}
        {isPartitionSource && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="rounded-lg border border-orange-800 bg-orange-950/40 px-3 py-2 text-xs text-orange-400">
              ✕ Network partition active
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Metrics */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-zinc-900/60 p-2 text-center">
          <p className="text-zinc-500">Lag</p>
          <p className="font-mono font-bold text-zinc-200">
            {node.state === "UNREACHABLE" ? "∞" : `${(node.lagMs ?? 0).toFixed(1)} ms`}
          </p>
        </div>
        <div className="rounded-lg bg-zinc-900/60 p-2 text-center">
          <p className="text-zinc-500">Role</p>
          <p className={`font-bold ${node.id === 0 ? "text-blue-400" : "text-zinc-400"}`}>
            {node.id === 0 ? "PRIMARY" : "REPLICA"}
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={onKill}
          disabled={!isHealthy && node.state !== "SUSPECT"}
          className="flex-1 rounded-lg border border-red-800 bg-red-950/30 py-1.5 text-xs font-bold text-red-400 transition hover:bg-red-900/40 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          Kill
        </button>
        <button
          onClick={onRecover}
          disabled={isHealthy}
          className="flex-1 rounded-lg border border-blue-800 bg-blue-950/30 py-1.5 text-xs font-bold text-blue-400 transition hover:bg-blue-900/40 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          Recover
        </button>
      </div>

      <style>{`
        @keyframes fastPulse { 0%,100% { opacity:1 } 50% { opacity:0.3 } }
      `}</style>
    </motion.div>
  );
}
