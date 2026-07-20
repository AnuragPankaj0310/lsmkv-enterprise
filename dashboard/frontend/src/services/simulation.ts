import type {
  NodeState,
  NodeRuntimeState,
  FailureType,
  NodeFailure,
  NetworkPartition,
  ClusterEvent,
} from "../types/failure";
import { FAILURE_LABELS } from "../types/failure";
import { eventBus } from "./eventBus";
// React import required for the Dispatch type
import type React from "react";

// ── Node name helpers — dynamic, no hardcoded array ──────────────────────────

function nodeName(id: number): string {
  return `node${id}`;
}

// ── Failure state machine ─────────────────────────────────────────────────────

/**
 * Each failure type has distinct cross-page effects:
 *
 * | Type               | Node state       | Lag     | CPU   | Storage overlay |
 * |--------------------|------------------|---------|-------|-----------------| 
 * | node_crash         | →UNREACHABLE     | ∞       | 0     | NODE DOWN       |
 * | heartbeat_timeout  | →UNREACHABLE     | ∞       | 0     | NODE DOWN       |
 * | high_cpu           | →SUSPECT only    | +120 ms | +55%  | writes delayed  |
 * | high_latency       | →SUSPECT only    | +350 ms | +10%  | writes delayed  |
 * | disk_full          | →SUSPECT→UNREACHABLE | ∞   | 0     | DISK FULL       |
 * | wal_corruption     | →SUSPECT→UNREACHABLE | ∞   | 0     | WAL CORRUPT     |
 * | sstable_corruption | →SUSPECT only    | +200 ms | +25%  | READ ERRORS     |
 * | readonly_disk      | →SUSPECT only    | +80 ms  | +5%   | READ ONLY       |
 * | network_partition  | stays HEALTHY    | +500 ms | 0     | (handled separately) |
 */
type FailureBehavior = {
  finalState: NodeState;
  lagMs: number;
  cpuBoost: number;
  crashAfterMs?: number;   // if set, transitions to UNREACHABLE after this delay
  rebalanceAfterMs?: number;
};

const FAILURE_BEHAVIORS: Record<FailureType, FailureBehavior> = {
  node_crash:         { finalState: "UNREACHABLE", lagMs: 9999, cpuBoost: 0,  crashAfterMs: 2000, rebalanceAfterMs: 5000 },
  heartbeat_timeout:  { finalState: "UNREACHABLE", lagMs: 9999, cpuBoost: 0,  crashAfterMs: 2500, rebalanceAfterMs: 6000 },
  disk_full:          { finalState: "UNREACHABLE", lagMs: 9999, cpuBoost: 0,  crashAfterMs: 3000, rebalanceAfterMs: 6500 },
  wal_corruption:     { finalState: "UNREACHABLE", lagMs: 9999, cpuBoost: 0,  crashAfterMs: 2000, rebalanceAfterMs: 5000 },
  high_cpu:           { finalState: "SUSPECT",     lagMs: 120,  cpuBoost: 55 },
  high_latency:       { finalState: "SUSPECT",     lagMs: 350,  cpuBoost: 10 },
  sstable_corruption: { finalState: "SUSPECT",     lagMs: 200,  cpuBoost: 25 },
  readonly_disk:      { finalState: "SUSPECT",     lagMs: 80,   cpuBoost: 5  },
  network_partition:  { finalState: "SUSPECT",     lagMs: 500,  cpuBoost: 0  },
};

// Failure types that map to backend-supported injection
const BACKEND_FAILURE_MAP: Partial<Record<FailureType, string>> = {
  node_crash:        "crash",
  heartbeat_timeout: "heartbeat_timeout",
  high_latency:      "high_latency",
  high_cpu:          "high_cpu",
};

/**
 * Fire-and-forget backend chaos injection.
 * Never throws — frontend behavior is fully driven by local state.
 */
async function _injectBackend(nodeId: number, type: FailureType): Promise<void> {
  const backendType = BACKEND_FAILURE_MAP[type];
  if (!backendType) return;
  try {
    await fetch("/api/inject_failure", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ node_id: nodeId, failure_type: backendType }),
    });
  } catch {
    // backend offline — UI state drives everything regardless
  }
}

async function _recoverBackend(nodeId: number): Promise<void> {
  try {
    await fetch("/api/recover_node", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ node_id: nodeId }),
    });
  } catch {
    // ignore
  }
}

/**
 * Inject a failure on a node.
 *
 * Soft failures (high_cpu, high_latency, etc.) stay SUSPECT —
 * they degrade Metrics and Replication but don't crash the node.
 *
 * Hard failures (node_crash, disk_full, etc.) progress through
 * SUSPECT → UNREACHABLE → REBALANCING.
 */
export function injectFailure(
  nodeId: number,
  type: FailureType,
  _nodes: NodeRuntimeState[],
  setNodes: React.Dispatch<React.SetStateAction<NodeRuntimeState[]>>
): void {
  const name  = nodeName(nodeId);
  const label = FAILURE_LABELS[type];
  const behavior = FAILURE_BEHAVIORS[type];
  if (!behavior) return; // guard against unknown types
  const failure: NodeFailure = { nodeId, type, startedAt: Date.now(), label };

  // Fire-and-forget to backend (non-crashing)
  void _injectBackend(nodeId, type);

  // Step 1 — Always enter SUSPECT first
  _updateNode(setNodes, nodeId, {
    state: "SUSPECT",
    activeFailure: failure,
    lagMs: behavior.lagMs,
    cpuBoost: behavior.cpuBoost,
  });
  _emit({ type: "FAILURE_INJECTED", nodeId, failure,
    message: `[FAULT INJECTED] ${name}: ${label}`, timestamp: Date.now() });
  _emit({ type: "NODE_STATE_CHANGED", nodeId, nodeState: "SUSPECT",
    message: `${name} entering SUSPECT state — ${label} detected`, timestamp: Date.now() });

  // Step 2 — Hard failures crash to UNREACHABLE
  if (behavior.crashAfterMs !== undefined) {
    setTimeout(() => {
      _updateNode(setNodes, nodeId, { state: "UNREACHABLE", lagMs: 9999, cpuBoost: 0 });
      _emit({ type: "NODE_STATE_CHANGED", nodeId, nodeState: "UNREACHABLE",
        message: `${name} UNREACHABLE — ${label} caused node to stop responding`, timestamp: Date.now() });
    }, behavior.crashAfterMs);
  }

  // Step 3 — REBALANCING after crash
  if (behavior.rebalanceAfterMs !== undefined) {
    setTimeout(() => {
      _updateNode(setNodes, nodeId, { state: "REBALANCING" });
      _emit({ type: "REBALANCE_STARTED", nodeId,
        message: `Rebalancing started — redistributing keys from ${name}`, timestamp: Date.now() });
    }, behavior.rebalanceAfterMs);
  }
}

/**
 * Recover a node: UNREACHABLE/REBALANCING/SUSPECT → RECOVERING → HEALTHY
 */
export function recoverNode(
  nodeId: number,
  setNodes: React.Dispatch<React.SetStateAction<NodeRuntimeState[]>>
): void {
  const name = nodeName(nodeId);

  // Fire-and-forget to backend
  void _recoverBackend(nodeId);

  _updateNode(setNodes, nodeId, {
    state: "RECOVERING",
    lagMs: 120,
    cpuBoost: 0,
    activeFailure: undefined,
  });
  _emit({ type: "NODE_RECOVERED", nodeId, nodeState: "RECOVERING",
    message: `${name} recovering — rejoining cluster`, timestamp: Date.now() });

  setTimeout(() => {
    _updateNode(setNodes, nodeId, {
      state: "HEALTHY",
      lagMs: 1 + nodeId * 0.8,
      cpuBoost: 0,
    });
    _emit({ type: "NODE_STATE_CHANGED", nodeId, nodeState: "HEALTHY",
      message: `${name} HEALTHY — fully rejoined the cluster`, timestamp: Date.now() });
    _emit({ type: "REBALANCE_COMPLETED", nodeId,
      message: `Rebalancing complete — ${name} integrated`, timestamp: Date.now() });
  }, 3500);
}

// ── Partition ────────────────────────────────────────────────────────────────

export function createPartition(from: number, to: number): NetworkPartition {
  const partition: NetworkPartition = { from, to, startedAt: Date.now() };
  _emit({
    type: "PARTITION_CREATED",
    message: `Network partition: ${nodeName(from)} ✕ ${nodeName(to)} — packets dropping`,
    timestamp: Date.now(),
  });
  // Fire-and-forget to backend
  void fetch("/api/partition", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from_node: from, to_node: to }),
  }).catch(() => {});
  return partition;
}

export function healPartition(from: number, to: number): void {
  _emit({
    type: "PARTITION_HEALED",
    message: `Partition healed: ${nodeName(from)} ↔ ${nodeName(to)} — link restored`,
    timestamp: Date.now(),
  });
  // Fire-and-forget to backend
  void fetch("/api/heal_partition", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from_node: from, to_node: to }),
  }).catch(() => {});
}

// ── Private helpers ──────────────────────────────────────────────────────────

function _updateNode(
  setNodes: React.Dispatch<React.SetStateAction<NodeRuntimeState[]>>,
  nodeId: number,
  patch: Partial<NodeRuntimeState>
): void {
  setNodes((prev) =>
    prev.map((n) => (n.id === nodeId ? { ...n, ...patch } : n))
  );
}

function _emit(event: ClusterEvent): void {
  eventBus.emit(event);
}
