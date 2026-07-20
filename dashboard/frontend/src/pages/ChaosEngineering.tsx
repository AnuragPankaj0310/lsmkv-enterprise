import { useState } from "react";
import SectionHeader from "../components/SectionHeader";
import { useCluster } from "../context/ClusterContext";
import { NodeStateCard } from "../components/chaos/NodeStateCard";
import { FailureTypeSelector } from "../components/chaos/FailureTypeSelector";
import { NetworkPartitionView } from "../components/chaos/NetworkPartitionView";
import type { FailureType } from "../types/failure";
import { STATE_COLORS } from "../types/failure";


export default function ChaosEngineering() {
  const {
    nodes,
    partitions,
    dispatchFailure,
    dispatchRecover,
    dispatchPartition,
    dispatchHealPartition,
    dispatchRecoverAll,
    isPartitioned,
  } = useCluster();

  const [selectedNode, setSelectedNode] = useState<number | null>(null);

  const dynamicPairs: [number, number][] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      dynamicPairs.push([i, j]);
    }
  }

  function handleInject(type: FailureType) {
    if (selectedNode === null) return;
    dispatchFailure(selectedNode, type);
    setSelectedNode(null);
  }

  const healthyCount = nodes.filter((n) => n.state === "HEALTHY").length;
  const hasAnyFailure = nodes.some((n) => n.state !== "HEALTHY") || partitions.length > 0;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <SectionHeader
          title="Chaos Engineering"
          subtitle="Inject faults, simulate partitions, and observe cluster resilience"
        />
        <div className="flex items-center gap-3 mt-1">
          {hasAnyFailure && (
            <button
              onClick={dispatchRecoverAll}
              className="rounded-lg border border-green-700 bg-green-950/40 px-4 py-2 text-sm font-bold text-green-400 hover:bg-green-900/40 transition"
            >
              ✓ Recover All
            </button>
          )}
          <span className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold tracking-widest ${
            healthyCount === nodes.length
              ? "border-green-700 bg-green-950/50 text-green-400"
              : healthyCount === 0
              ? "border-red-700 bg-red-950/50 text-red-400"
              : "border-yellow-700 bg-yellow-950/50 text-yellow-400"
          }`}>
            <span className="h-2.5 w-2.5 rounded-full" style={{
              backgroundColor: healthyCount === nodes.length ? "#4ade80" : healthyCount === 0 ? "#f87171" : "#facc15",
              animation: "pulse 2s infinite",
            }} />
            {healthyCount}/{nodes.length} HEALTHY
          </span>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-5 gap-3">
        {(["HEALTHY", "SUSPECT", "UNREACHABLE", "RECOVERING", "REBALANCING"] as const).map((state) => {
          const count = nodes.filter((n) => n.state === state).length;
          const { text, bg, border } = STATE_COLORS[state];
          return (
            <div key={state} className={`rounded-xl border p-4 text-center ${bg} ${border}`}>
              <p className={`text-[10px] font-bold uppercase tracking-widest ${text}`}>{state}</p>
              <p className={`text-2xl font-bold mt-1 ${text}`}>{count}</p>
            </div>
          );
        })}
      </div>

      {/* Node cards — click to select target */}
      <div>
        <p className="text-xs text-zinc-500 uppercase tracking-wider mb-3">
          Select target node to inject failure
        </p>
        <div className="grid grid-cols-3 gap-4">
          {nodes.map((node) => (
            <div
              key={node.id}
              onClick={() => setSelectedNode(selectedNode === node.id ? null : node.id)}
              className={`cursor-pointer rounded-xl transition-all duration-200 ${
                selectedNode === node.id
                  ? "ring-2 ring-yellow-500 ring-offset-2 ring-offset-zinc-950"
                  : "hover:ring-1 hover:ring-zinc-600 hover:ring-offset-1 hover:ring-offset-zinc-950"
              }`}
            >
              <NodeStateCard
                node={node}
                onKill={(e?: React.MouseEvent) => { e?.stopPropagation?.(); dispatchFailure(node.id, "node_crash"); }}
                onRecover={(e?: React.MouseEvent) => { e?.stopPropagation?.(); dispatchRecover(node.id); }}
                isPartitionSource={partitions.some((p) => p.from === node.id || p.to === node.id)}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Failure type selector */}
      <FailureTypeSelector
        selectedNode={selectedNode}
        onInject={handleInject}
      />

      {/* Network partition section */}
      <div className="rounded-xl bg-zinc-900 p-5 space-y-4">
        <p className="text-xs text-zinc-500 uppercase tracking-wider">✂️ Network Partitions</p>

        <div className="grid grid-cols-2 gap-6">
          {/* Partition controls */}
          <div className="space-y-3">
            <p className="text-xs text-zinc-600">Click a pair to partition / heal it</p>
            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
              {dynamicPairs.map(([a, b]) => {
                const partitioned = isPartitioned(a, b);
                return (
                  <button
                    key={`${a}-${b}`}
                    onClick={() =>
                      partitioned ? dispatchHealPartition(a, b) : dispatchPartition(a, b)
                    }
                    className={`w-full flex items-center justify-between rounded-lg border px-4 py-2.5 text-sm font-mono transition ${
                      partitioned
                        ? "border-red-700 bg-red-950/40 text-red-400 hover:bg-red-900/40"
                        : "border-zinc-700 bg-zinc-800/40 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
                    }`}
                  >
                    <span>node{a} ↔ node{b}</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                      partitioned
                        ? "border-red-700 text-red-400 bg-red-950/60"
                        : "border-zinc-700 text-zinc-600"
                    }`}>
                      {partitioned ? "PARTITIONED" : "CONNECTED"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Animated partition view */}
          <div>
            <NetworkPartitionView partitions={partitions} nodeCount={nodes.length} />
            {partitions.length === 0 && (
              <p className="text-center text-xs text-zinc-600 mt-2">All links healthy</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
