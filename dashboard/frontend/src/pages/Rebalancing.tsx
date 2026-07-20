import { useState, useEffect, useRef } from "react";
import SectionHeader from "../components/SectionHeader";
import { useCluster } from "../context/ClusterContext";
import { getCluster } from "../api/cluster";
import { getStorage } from "../api/live";

// ── Types ──────────────────────────────────────────────────────────────────
interface Token {
  id: number;
  fromNode: number;
  toNode: number;
  keyName: string;
  progress: number; // 0..1
  color: string;
}

interface RebalanceState {
  running: boolean;
  totalKeys: number;
  movedKeys: number;
  startTime: number | null;
  keysPerSec: number;
}

const NODE_COLORS = ["#60a5fa", "#4ade80", "#facc15", "#c084fc", "#f472b6", "#2dd4bf"];
const W = 360, H = 300;

// ── Moving token animation ──────────────────────────────────────────────────
function AnimatedTokens({ tokens, totalNodes }: { tokens: Token[], totalNodes: number }) {
  const getPos = (i: number) => {
    if (totalNodes === 1) return { x: W/2, y: H/2 };
    const angle = -Math.PI / 2 + (Math.PI * 2 * i) / totalNodes;
    return {
      x: W/2 + Math.cos(angle) * 100,
      y: H/2 + Math.sin(angle) * 100,
    };
  };

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
      {/* Background edges */}
      {Array.from({ length: totalNodes }).flatMap((_, a) =>
        Array.from({ length: totalNodes })
          .map((_, b) => b)
          .filter((b) => b > a)
          .map((b) => {
            const pA = getPos(a);
            const pB = getPos(b);
            return (
              <line key={`${a}-${b}`}
                x1={pA.x} y1={pA.y}
                x2={pB.x} y2={pB.y}
                stroke="#3f3f46" strokeWidth={1.5} strokeDasharray="5 4"
              />
            );
          })
      )}

      {/* Moving tokens */}
      {tokens.map((tok) => {
        const from = getPos(tok.fromNode);
        const to   = getPos(tok.toNode);
        const px = from.x + (to.x - from.x) * tok.progress;
        const py = from.y + (to.y - from.y) * tok.progress;
        const opacity = tok.progress < 0.1 ? tok.progress * 10 : tok.progress > 0.9 ? (1 - tok.progress) * 10 : 1;
        return (
          <g key={tok.id}>
            <circle cx={px} cy={py} r={7} fill={tok.color} opacity={opacity} />
            <text x={px} y={py + 16} textAnchor="middle" fill="#a1a1aa" fontSize={7} opacity={opacity}>
              {tok.keyName}
            </text>
          </g>
        );
      })}

      {/* Node circles */}
      {Array.from({ length: totalNodes }).map((_, i) => {
        const p = getPos(i);
        const color = NODE_COLORS[i % NODE_COLORS.length];
        return (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={30} fill="#18181b" stroke={color} strokeWidth={2.5} />
            <text x={p.x} y={p.y + 1} textAnchor="middle" dominantBaseline="middle"
              fill={color} fontSize={11} fontWeight="bold">
              node{i}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ── Progress bar ────────────────────────────────────────────────────────────
function ProgressBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="h-3 w-full rounded-full bg-zinc-800 overflow-hidden">
      <div className="h-3 rounded-full transition-all duration-200"
        style={{ width: `${pct}%`, backgroundColor: color }}
      />
    </div>
  );
}

// ── ETA formatter ───────────────────────────────────────────────────────────
function fmtEta(remaining: number, kps: number): string {
  if (kps <= 0) return "—";
  const secs = Math.ceil(remaining / kps);
  if (secs > 60) return `${Math.ceil(secs / 60)}m ${secs % 60}s`;
  return `${secs}s`;
}

// ── Page ────────────────────────────────────────────────────────────────────
export default function Rebalancing() {
  const { nodes: runtimeNodes } = useCluster();
  const totalNodes = runtimeNodes.length;
  
  const downCount      = runtimeNodes.filter((n) => n.state === "UNREACHABLE").length;
  const rebalancingAny = runtimeNodes.some((n) => n.state === "REBALANCING");

  // Real key count fetched from backend
  const [realKeyCount, setRealKeyCount] = useState(100);
  // Real per-node key counts from /storage endpoint
  const [nodeKeyCounts, setNodeKeyCounts] = useState<Record<number, number>>({});
  const [storageBackendOnline, setStorageBackendOnline] = useState(false);
  
  useEffect(() => {
    async function fetchData() {
      try {
        const [cluster, storage] = await Promise.all([getCluster(), getStorage()]);
        setRealKeyCount(cluster.key_count);
        // Build per-node key count map
        const counts: Record<number, number> = {};
        storage.forEach((n: any) => {
          if (n.key_count !== undefined) counts[n.id] = n.key_count;
        });
        setNodeKeyCounts(counts);
        setStorageBackendOnline(true);
      } catch { setStorageBackendOnline(false); }
    }
    fetchData();
    const t = setInterval(fetchData, 5000);
    return () => clearInterval(t);
  }, []);

  const [state, setState] = useState<RebalanceState>({
    running: false,
    totalKeys: 100,
    movedKeys: 0,
    startTime: null,
    keysPerSec: 0,
  });
  const [tokens, setTokens] = useState<Token[]>([]);
  const nextId = useRef(0);
  const intervalRefs = useRef<ReturnType<typeof setInterval>[]>([]);
  // Ref so startRebalance always sees the latest realKeyCount
  const realKeyCountRef = useRef(100);
  useEffect(() => { realKeyCountRef.current = realKeyCount; }, [realKeyCount]);

  function clearIntervals() {
    intervalRefs.current.forEach(clearInterval);
    intervalRefs.current = [];
  }

  function startRebalance() {
    if (totalNodes <= 1) return;
    
    // Use the real key count fetched on mount
    const targetKeys = Math.max(20, realKeyCountRef.current);

    setState({ running: true, totalKeys: targetKeys, movedKeys: 0, startTime: Date.now(), keysPerSec: 0 });
    setTokens([]);

    // Spawn tokens every 400ms
    const spawnId = setInterval(() => {
      setState((s) => {
        if (!s.running || s.movedKeys >= s.totalKeys) return s;
        return s; // don't mutate here, handled by complete tick
      });

      setTokens((prev) => {
        const aliveIds = runtimeNodes.filter(n => n.state !== "UNREACHABLE").map(n => n.id);
        if (aliveIds.length <= 1) return prev; // Cannot rebalance to self

        const from = Math.floor(Math.random() * totalNodes); // Can migrate away from crashed nodes
        let to = aliveIds[Math.floor(Math.random() * aliveIds.length)];
        while (to === from) to = aliveIds[Math.floor(Math.random() * aliveIds.length)];
        
        const tok: Token = {
          id: nextId.current++,
          fromNode: from,
          toNode: to,
          keyName: `key_${Math.floor(Math.random() * 999)}`,
          progress: 0,
          color: NODE_COLORS[from % NODE_COLORS.length],
        };
        return [...prev.slice(-12), tok];
      });
    }, 400);

    // Animate tokens
    const animId = setInterval(() => {
      setTokens((prev) =>
        prev
          .map((t) => ({ ...t, progress: t.progress + 0.025 }))
          .filter((t) => t.progress <= 1.05)
      );
    }, 50);

    // Advance moved keys counter
    const countId = setInterval(() => {
      setState((s) => {
        if (!s.running) return s;
        const newMoved = Math.min(s.movedKeys + Math.floor(Math.random() * 3) + 1, s.totalKeys);
        const elapsed = (Date.now() - (s.startTime ?? Date.now())) / 1000;
        const kps = elapsed > 0 ? +(newMoved / elapsed).toFixed(1) : 0;
        if (newMoved >= s.totalKeys) {
          clearIntervals();
          return { ...s, movedKeys: s.totalKeys, keysPerSec: kps, running: false };
        }
        return { ...s, movedKeys: newMoved, keysPerSec: kps };
      });
    }, 600);

    intervalRefs.current = [spawnId, animId, countId];
  }

  function stopRebalance() {
    clearIntervals();
    setState((s) => ({ ...s, running: false }));
    setTokens([]);
  }

  // Cleanup on unmount
  useEffect(() => () => clearIntervals(), []);

  const pct = state.totalKeys > 0 ? Math.round((state.movedKeys / state.totalKeys) * 100) : 0;
  const isDone = !state.running && state.movedKeys >= state.totalKeys && state.movedKeys > 0;

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
        <SectionHeader title="Rebalancing" subtitle="Animated key redistribution across cluster nodes" />
        <div className="flex gap-2 mt-1">
          {state.running ? (
            <button onClick={stopRebalance}
              className="rounded-lg border border-red-700 bg-red-950/40 px-4 py-2 text-sm font-bold text-red-400 hover:bg-red-900/40 transition">
              ⏹ Stop
            </button>
          ) : (
            <button onClick={startRebalance} disabled={totalNodes <= 1}
              className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-bold text-white hover:bg-blue-500 transition disabled:opacity-50 disabled:cursor-not-allowed">
              ▶ Start Rebalance
            </button>
          )}
        </div>
      </div>

      {/* Chaos-state banners */}
      {rebalancingAny && (
        <div className="rounded-xl border border-purple-700 bg-purple-950/30 px-5 py-3 flex items-center gap-3">
          <span className="text-purple-400 text-xl animate-pulse">↻</span>
          <div>
            <p className="text-purple-400 font-bold text-sm">Rebalancing triggered by Chaos Engineering</p>
            <p className="text-purple-300/70 text-xs">A node state change initiated rebalancing. Keys are being redistributed automatically.</p>
          </div>
        </div>
      )}
      {downCount > 0 && !rebalancingAny && (
        <div className="rounded-xl border border-yellow-700 bg-yellow-950/30 px-5 py-3 flex items-center gap-3">
          <span className="text-yellow-400 text-xl">⚠</span>
          <div>
            <p className="text-yellow-400 font-bold text-sm">{downCount} node{downCount > 1 ? "s" : ""} down — rebalancing recommended</p>
            <p className="text-yellow-300/70 text-xs">Key distribution is uneven. Start a rebalance to redistribute load across remaining healthy nodes.</p>
          </div>
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { icon: "🔄", label: "Progress",     value: `${pct}%` },
          { icon: "🗄", label: "Keys Moved",   value: `${state.movedKeys} / ${state.totalKeys}` },
          { icon: "⚡", label: "Keys / sec",   value: state.running ? `${state.keysPerSec}` : "—" },
          {
            icon: "⏱", label: "ETA",
            value: state.running
              ? fmtEta(state.totalKeys - state.movedKeys, state.keysPerSec)
              : isDone ? "Done ✓" : "—"
          },
        ].map((s) => (
          <div key={s.label} className="rounded-xl bg-zinc-900 p-5">
            <p className="text-xs text-zinc-500 uppercase tracking-wider">{s.icon} {s.label}</p>
            <h2 className="mt-2 text-2xl font-bold">{s.value}</h2>
          </div>
        ))}
      </div>

      {/* Progress bar */}
      <div className="rounded-xl bg-zinc-900 p-5 space-y-3">
        <div className="flex justify-between text-xs text-zinc-500">
          <span>Key migration progress</span>
          <span className="font-mono">{state.movedKeys} / {state.totalKeys} keys</span>
        </div>
        <ProgressBar pct={pct} color={isDone ? "#4ade80" : state.running ? "#60a5fa" : "#3f3f46"} />
        {isDone && (
          <p className="text-sm text-green-400 font-medium">✅ Rebalancing complete — all keys redistributed evenly.</p>
        )}
        {state.running && (
          <p className="text-xs text-blue-400 animate-pulse">Moving keys across nodes…</p>
        )}
        {!state.running && !isDone && (
          <p className="text-xs text-zinc-600">Click "Start Rebalance" to begin key redistribution.</p>
        )}
      </div>

      {/* Animation */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-xl bg-zinc-900 p-5">
          <p className="text-xs text-zinc-500 uppercase tracking-wider mb-4">🎬 Live Key Movement</p>
          <AnimatedTokens tokens={tokens} totalNodes={totalNodes} />
        </div>

        {/* Per-node breakdown */}
        <div className="rounded-xl bg-zinc-900 p-5 space-y-4 max-h-[350px] overflow-y-auto custom-scrollbar">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-zinc-500 uppercase tracking-wider">📊 Node Distribution</p>
            <span className={`text-[10px] font-bold ${storageBackendOnline ? "text-green-400" : "text-zinc-600"}`}>
              {storageBackendOnline ? "🟢 Live from Prometheus" : "🟡 Estimated"}
            </span>
          </div>
          {runtimeNodes.map((n, i) => {
            const aliveNodes = Math.max(1, totalNodes - downCount);
            const totalK = state.totalKeys || realKeyCount;
            const nodeTarget = n.state !== "UNREACHABLE" ? Math.round(totalK / aliveNodes) : 0;
            const isDown = n.state === "UNREACHABLE";

            // Use real key count when available, else estimate
            const hasReal = storageBackendOnline && nodeKeyCounts[n.id] !== undefined;
            const realK = nodeKeyCounts[n.id] ?? 0;

            // During rebalance: animate from real → target; at rest: show real
            const displayKeys = isDown ? 0 : hasReal
              ? state.running
                ? Math.round(realK + (nodeTarget - realK) * (pct / 100))
                : realK
              : Math.round(totalK / totalNodes);

            const pctBar = nodeTarget > 0
              ? Math.round((Math.max(displayKeys, 0) / nodeTarget) * 100)
              : 0;

            return (
              <div key={n.id} className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className={`font-mono ${isDown ? "text-zinc-600 line-through" : "text-zinc-300"}`}>node{n.id}</span>
                  <span className="text-zinc-500">
                    {Math.max(displayKeys, 0).toLocaleString()}{hasReal && !state.running ? " (actual)" : ""} → target {nodeTarget.toLocaleString()}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-zinc-800">
                  <div className="h-2 rounded-full transition-all duration-500"
                    style={{ width: `${isDown ? 0 : Math.min(120, pctBar)}%`, backgroundColor: NODE_COLORS[i % NODE_COLORS.length] }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #3f3f46; border-radius: 4px; }
      `}</style>
    </div>
  );
}