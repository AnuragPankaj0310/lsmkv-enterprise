/**
 * QueryTrace — slide-in drawer showing the full distributed request path.
 *
 * For GET: Hash(key) → Primary node → Bloom filter → L0 miss → L1 miss → L2 FOUND → return
 * For SET: Hash → Primary → WAL append → MemTable insert → Replicate → Quorum → ACK
 *
 * Each step animates in sequence with realistic timing.
 */
import { useState, useEffect } from "react";
import type { NodeRuntimeState } from "../../types/failure";

export interface QueryTraceProps {
  open: boolean;
  onClose: () => void;
  queryType: "GET" | "SET";
  queryKey: string;
  queryValue?: string;
  result?: string | null;
  nodes: NodeRuntimeState[];
}

interface TraceStep {
  id: string;
  icon: string;
  label: string;
  detail: string;
  latencyMs: number;
  status: "pending" | "running" | "done" | "error";
  color: string;
}

// Simple djb2-like hash for visual purposes
function hashKey(key: string): number {
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = (h * 33) ^ key.charCodeAt(i);
  return ((h >>> 0) % 360);
}

function buildGetSteps(key: string, nodes: NodeRuntimeState[]): TraceStep[] {
  const hashAngle = hashKey(key);
  const nodeCount = nodes.length || 3;
  const primaryIdx = Math.abs(hashKey(key)) % nodeCount;
  const primary = nodes[primaryIdx];
  const replicas = nodes.filter((_, i) => i !== primaryIdx).slice(0, 2);
  void replicas;


  return [
    {
      id: "hash", icon: "#", label: "Consistent Hash",
      detail: `Hash("${key}") = ${hashAngle}° → partition ${primaryIdx}`,
      latencyMs: 0, status: "pending", color: "#60a5fa",
    },
    {
      id: "route", icon: "→", label: `Route to Primary`,
      detail: `Primary: ${primary?.name ?? `node${primaryIdx}`} (port ${7001 + primaryIdx})`,
      latencyMs: Math.round(Math.random() * 2 + 1), status: "pending", color: "#4ade80",
    },
    {
      id: "bloom", icon: "🔍", label: "Bloom Filter Check",
      detail: `3 hash functions → bits set → MIGHT EXIST (fp_rate 0.4%)`,
      latencyMs: Math.round(Math.random() * 0.5 * 10) / 10, status: "pending", color: "#fbbf24",
    },
    {
      id: "l0", icon: "L0", label: "Level 0 Scan",
      detail: `Check ${2 + primaryIdx} L0 SSTables → MISS`,
      latencyMs: Math.round(Math.random() * 3 + 1), status: "pending", color: "#fb923c",
    },
    {
      id: "l1", icon: "L1", label: "Level 1 Scan",
      detail: `Binary search in 2 L1 SSTables → MISS`,
      latencyMs: Math.round(Math.random() * 5 + 2), status: "pending", color: "#fb923c",
    },
    {
      id: "l2", icon: "L2", label: "Level 2 — FOUND",
      detail: `Block offset 0x3A2F → read 4KB block → decompress Snappy → extract value`,
      latencyMs: Math.round(Math.random() * 8 + 4), status: "pending", color: "#4ade80",
    },
    {
      id: "return", icon: "↩", label: "Return to Client",
      detail: `Value ready · total read amplification: 3 SSTables`,
      latencyMs: Math.round(Math.random() * 1 + 1), status: "pending", color: "#60a5fa",
    },
  ];
}

function buildSetSteps(key: string, value: string, nodes: NodeRuntimeState[]): TraceStep[] {
  const nodeCount = nodes.length || 3;
  const primaryIdx = Math.abs(hashKey(key)) % nodeCount;
  const primary = nodes[primaryIdx];
  const replicas = nodes.filter((_, i) => i !== primaryIdx).slice(0, 2);
  const replicaNames = replicas.map((r, i) => r?.name ?? `node${primaryIdx + 1 + i}`).join(", ");

  return [
    {
      id: "hash", icon: "#", label: "Consistent Hash",
      detail: `Hash("${key}") → partition ${primaryIdx}`,
      latencyMs: 0, status: "pending", color: "#60a5fa",
    },
    {
      id: "primary", icon: "→", label: `Route to Primary`,
      detail: `Primary: ${primary?.name ?? `node${primaryIdx}`} accepts write`,
      latencyMs: Math.round(Math.random() * 2 + 1), status: "pending", color: "#4ade80",
    },
    {
      id: "wal", icon: "📝", label: "WAL Append",
      detail: `seq=${Math.floor(Math.random() * 9999)} appended to WAL segment — durable`,
      latencyMs: Math.round(Math.random() * 3 + 1), status: "pending", color: "#fbbf24",
    },
    {
      id: "memtable", icon: "🧠", label: "MemTable Insert",
      detail: `SkipList insert: key="${key}" value="${value?.substring(0, 20) ?? "…"}" · ${Math.round(Math.random() * 50 + 10)}KB used`,
      latencyMs: Math.round(Math.random() * 0.5 * 10) / 10, status: "pending", color: "#c084fc",
    },
    {
      id: "replicate", icon: "⇄", label: "Replicate to Followers",
      detail: `Sending to: ${replicaNames || "node1, node2"} (RF=${Math.min(nodeCount, 3)})`,
      latencyMs: Math.round(Math.random() * 8 + 3), status: "pending", color: "#f472b6",
    },
    {
      id: "quorum", icon: "✓", label: "Quorum Achieved",
      detail: `${Math.min(nodeCount, 2)} / ${Math.min(nodeCount, 3)} replicas ACK'd (majority)`,
      latencyMs: Math.round(Math.random() * 2 + 1), status: "pending", color: "#4ade80",
    },
    {
      id: "ack", icon: "↩", label: "ACK to Client",
      detail: `Write committed · linearizable consistency guaranteed`,
      latencyMs: Math.round(Math.random() * 1), status: "pending", color: "#60a5fa",
    },
  ];
}

export default function QueryTrace({
  open, onClose, queryType, queryKey, queryValue, result, nodes,
}: QueryTraceProps) {
  const [steps, setSteps] = useState<TraceStep[]>([]);

  useEffect(() => {
    if (!open || !queryKey) return;
    const newSteps =
      queryType === "GET"
        ? buildGetSteps(queryKey, nodes)
        : buildSetSteps(queryKey, queryValue ?? "", nodes);
    setSteps(newSteps);

    // Animate each step in sequence
    let acc = 200;
    newSteps.forEach((step, i) => {
      const startDelay = acc;
      acc += step.latencyMs * 8 + 300;

      setTimeout(() => {
        setSteps((prev) => prev.map((s, j) => j === i ? { ...s, status: "running" } : s));
      }, startDelay);

      setTimeout(() => {
        const isError = step.id === "l2" && queryType === "GET" && result === null;
        setSteps((prev) => prev.map((s, j) => j === i ? { ...s, status: isError ? "error" : "done" } : s));
      }, acc - 100);
    });
  }, [open, queryKey, queryType]);

  const totalMs = steps.reduce((a, s) => a + s.latencyMs, 0);

  if (!open) return null;

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40"
        onClick={onClose}
      />
      {/* Drawer */}
      <div
        className="fixed right-0 top-0 bottom-0 w-96 bg-zinc-950 border-l border-zinc-800 z-50 flex flex-col shadow-2xl"
        style={{ animation: "slideInRight 0.25s ease-out" }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-zinc-800">
          <span className={`rounded-lg px-2.5 py-1 text-xs font-bold ${
            queryType === "GET" ? "bg-blue-600 text-white" : "bg-green-700 text-white"
          }`}>
            {queryType}
          </span>
          <span className="font-mono text-sm text-zinc-200 flex-1 truncate">{queryKey}</span>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition text-lg">✕</button>
        </div>

        {/* Subtitle */}
        <div className="px-5 py-2 border-b border-zinc-800/50 bg-zinc-900/30">
          <p className="text-[10px] text-zinc-500">
            {queryType === "GET" ? "Read path: Hash → Primary → Bloom Filter → LSM Levels" : "Write path: Hash → Primary → WAL → MemTable → Replicate → Quorum"}
          </p>
        </div>

        {/* Steps */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
          {steps.map((step, i) => {
            const isRunning = step.status === "running";
            const isDone = step.status === "done";
            const isError = step.status === "error";
            const isPending = step.status === "pending";
            return (
              <div key={step.id} className="flex gap-3">
                {/* Connector */}
                <div className="flex flex-col items-center">
                  <div
                    className={`h-8 w-8 rounded-lg flex items-center justify-center text-[10px] font-bold shrink-0 transition-all duration-300 ${
                      isRunning ? "ring-2" : ""
                    }`}
                    style={{
                      backgroundColor: isPending ? "#18181b" : step.color + (isDone || isRunning ? "22" : "11"),
                      borderColor: isPending ? "#27272a" : step.color,
                      border: `1px solid`,
                      color: isPending ? "#3f3f46" : step.color,
                      boxShadow: isRunning ? `0 0 8px ${step.color}66` : undefined,
                    }}
                  >
                    {isRunning ? <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⟳</span>
                    : isError ? "✗"
                    : isDone ? "✓"
                    : step.icon}
                  </div>
                  {i < steps.length - 1 && (
                    <div
                      className="w-px flex-1 mt-1 min-h-[12px]"
                      style={{ backgroundColor: isDone ? step.color + "44" : "#27272a" }}
                    />
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 pb-3">
                  <div className="flex items-center gap-2">
                    <p className={`text-sm font-bold ${isPending ? "text-zinc-600" : ""}`}
                      style={{ color: isPending ? undefined : step.color }}>
                      {step.label}
                    </p>
                    {(isDone || isError) && step.latencyMs > 0 && (
                      <span className="text-[10px] text-zinc-600 font-mono">+{step.latencyMs}ms</span>
                    )}
                  </div>
                  <p className={`text-[11px] mt-0.5 ${isPending ? "text-zinc-700" : "text-zinc-500"}`}>
                    {step.detail}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Result footer */}
        <div className="px-5 py-4 border-t border-zinc-800 space-y-2">
          {result !== undefined && (
            <div className={`rounded-lg px-3 py-2.5 ${
              result !== null
                ? "border border-green-800 bg-green-950/30"
                : "border border-zinc-700 bg-zinc-900"
            }`}>
              <p className="text-[10px] text-zinc-500 uppercase">Result</p>
              <p className={`text-sm font-mono mt-0.5 ${result !== null ? "text-green-300" : "text-zinc-500"}`}>
                {result !== null ? `"${result}"` : "(not found)"}
              </p>
            </div>
          )}
          <div className="flex justify-between text-[10px] text-zinc-600">
            <span>Total latency</span>
            <span className="font-mono font-bold text-zinc-400">{totalMs}ms</span>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </>
  );
}
