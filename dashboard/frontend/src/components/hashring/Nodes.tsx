import { motion, AnimatePresence } from "framer-motion";
import type { RingNode, RingKey } from "../../types/hashRing";
import { COLORS, NODE_RADIUS } from "../../utils/ringConstants";
import { polarToCartesian, resolveOwnerIndex } from "../../utils/ringGeometry";
import { useCluster } from "../../context/ClusterContext";

export interface NodesProps {
  nodes: RingNode[];
  keys: RingKey[];
}

// State-dependent ring visuals for failed nodes
const STATE_RING: Record<string, { glow: string; opacity: number; dash?: string }> = {
  HEALTHY:     { glow: "none",                              opacity: 1 },
  SUSPECT:     { glow: "0 0 14px rgba(250,204,21,.7)",      opacity: 0.85 },
  UNREACHABLE: { glow: "0 0 16px rgba(248,113,113,.8)",     opacity: 0.35, dash: "4 4" },
  RECOVERING:  { glow: "0 0 14px rgba(96,165,250,.6)",      opacity: 0.75 },
  REBALANCING: { glow: "0 0 14px rgba(192,132,252,.7)",     opacity: 0.6, dash: "6 3" },
};

/**
 * Anti-overlap: given a list of (x,y) positions that are too close together,
 * push them apart radially so labels never sit on top of each other.
 */
function spreadLabels(
  positions: { x: number; y: number; angle: number }[],
  minDist = 80
): { x: number; y: number }[] {
  const out = positions.map((p) => ({ ...p }));
  // Simple spring relaxation — 3 iterations is enough for ≤6 nodes
  for (let iter = 0; iter < 3; iter++) {
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const dx = out[j].x - out[i].x;
        const dy = out[j].y - out[i].y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
        if (dist < minDist) {
          const push = (minDist - dist) / 2;
          const nx = dx / dist, ny = dy / dist;
          out[i].x -= nx * push;
          out[i].y -= ny * push;
          out[j].x += nx * push;
          out[j].y += ny * push;
        }
      }
    }
  }
  return out;
}

export default function Nodes({ nodes, keys }: NodesProps) {
  // Always call useCluster — ClusterProvider wraps the whole app
  const { nodes: runtimeNodes } = useCluster();

  // Pre-compute label positions then de-overlap them
  const rawLabelPositions = nodes.map((node) => {
    const { x, y } = polarToCartesian(node.angle, NODE_RADIUS);
    const angleRad = (node.angle * Math.PI) / 180;
    const dx = Math.cos(angleRad);
    const dy = Math.sin(angleRad);

    // Push label farther out — 80px base, +20px for bottom sector
    const labelDist = 82 + (dy > 0.5 ? 20 : 0);
    return {
      x: x + dx * labelDist,
      y: y + dy * labelDist,
      angle: node.angle,
    };
  });

  const spreadPositions = spreadLabels(rawLabelPositions, 90);

  // Build alive-only node list for key redistribution.
  // When a node is UNREACHABLE its keys are remapped to the next alive node —
  // exactly what consistent hashing does in production.
  const aliveNodes = nodes.filter((n) => {
    const r = runtimeNodes.find((rt) => rt.id === n.id - 1); // ring=1-idx, ctx=0-idx
    return !r || r.state !== "UNREACHABLE";
  });

  return (
    <AnimatePresence mode="popLayout">
      {nodes.map((node, idx) => {
        const { x, y } = polarToCartesian(node.angle, NODE_RADIUS);

        // Key count: use aliveNodes so crashed nodes show 0 and survivors absorb keys
        const runtimeId = node.id - 1;
        const runtime = runtimeNodes.find((n) => n.id === runtimeId);
        const state = runtime?.state ?? "HEALTHY";
        const isDown = state === "UNREACHABLE";
        const keyCount = isDown
          ? 0
          : keys.filter((k) => resolveOwnerIndex(k, aliveNodes) === node.id).length;

        const host = node.addr ? node.addr.split(":")[0] : `node${node.id - 1}`;
        const port = node.addr ? node.addr.split(":")[1] : `700${node.id}`;

        const visual = STATE_RING[state] ?? STATE_RING.HEALTHY;
        const isSuspect = state === "SUSPECT";

        const colorClass = isDown
          ? "bg-zinc-700"
          : isSuspect
          ? "bg-yellow-700"
          : (COLORS[node.id] ?? "bg-zinc-600");

        const labelColor = isDown ? "#52525b" : isSuspect ? "#fbbf24" : "white";

        const { x: lx, y: ly } = spreadPositions[idx];
        const angleRad = (node.angle * Math.PI) / 180;
        const dxRaw = Math.cos(angleRad);
        const textAlign: "left" | "right" | "center" =
          dxRaw > 0.25 ? "left" : dxRaw < -0.25 ? "right" : "center";

        return (
          <motion.g key={node.id} layout>

            {/* ── Node circle ── */}
            <motion.div
              layoutId={`node-${node.id}`}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: visual.opacity }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ type: "spring", stiffness: 250, damping: 20 }}
              whileHover={{ scale: isDown ? 1 : 1.12 }}
              className="absolute group"
              style={{
                left: x,
                top: y,
                transform: "translate(-50%,-50%)",
                filter: isDown ? "grayscale(0.8) brightness(0.6)" : "none",
              }}
            >
              {/* Failure ring glow */}
              {state !== "HEALTHY" && (
                <div
                  className="absolute inset-0 rounded-full pointer-events-none"
                  style={{
                    boxShadow: visual.glow,
                    border: visual.dash
                      ? "2px dashed rgba(248,113,113,.7)"
                      : isSuspect
                      ? "2px dashed rgba(250,204,21,.6)"
                      : "none",
                  }}
                />
              )}

              {/* Circle body */}
              <div
                className={`flex h-12 w-12 items-center justify-center rounded-full ${colorClass} font-bold text-sm border border-white/20 shadow-[0_0_18px_rgba(0,0,0,.5)] transition-all duration-500`}
              >
                {isDown ? "✕" : node.id}
              </div>

              {/* Hover tooltip */}
              <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-3 hidden group-hover:block z-50">
                <div className="rounded-xl border border-zinc-700 bg-zinc-900/95 p-3 shadow-2xl backdrop-blur min-w-[148px]">
                  <p className="mb-2 font-bold text-sm">Node-{node.id}</p>
                  <div className="space-y-1 text-xs text-zinc-400">
                    <div className="flex justify-between gap-4"><span>Host</span><span className="text-zinc-200 font-mono">{host}</span></div>
                    <div className="flex justify-between gap-4"><span>Port</span><span className="text-zinc-200 font-mono">{port}</span></div>
                    <div className="flex justify-between gap-4">
                      <span>State</span>
                      <span className={isDown ? "text-red-400" : isSuspect ? "text-yellow-400" : "text-green-400"}>
                        {state}
                      </span>
                    </div>
                    <div className="flex justify-between gap-4"><span>Keys</span><span className="text-zinc-200 font-mono">{isDown ? "—" : keyCount}</span></div>
                  </div>
                  <div className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-zinc-700" />
                </div>
              </div>
            </motion.div>

            {/* ── Label — de-overlapped position ── */}
            <motion.div
              layout
              initial={{ opacity: 0 }}
              animate={{ opacity: visual.opacity }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
              className="absolute pointer-events-none select-none"
              style={{
                left: lx,
                top: ly,
                transform: "translate(-50%, -50%)",
                textAlign,
                whiteSpace: "nowrap",
              }}
            >
              <p
                className="text-sm font-bold leading-tight tracking-wide transition-colors duration-500"
                style={{ color: labelColor }}
              >
                Node-{node.id}
              </p>
              <p
                className="text-[10px] font-medium leading-tight mt-0.5 transition-colors duration-500"
                style={{ color: isDown ? "#52525b" : "#71717a" }}
              >
                {isDown ? state : `${keyCount} Keys`}
              </p>
            </motion.div>

          </motion.g>
        );
      })}
    </AnimatePresence>
  );
}
