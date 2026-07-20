// ── Node state machine ─────────────────────────────────────────────────────
export type NodeState =
  | "HEALTHY"
  | "SUSPECT"
  | "UNREACHABLE"
  | "RECOVERING"
  | "REBALANCING";

// ── Failure types ─────────────────────────────────────────────────────────
export type FailureType =
  | "node_crash"
  | "heartbeat_timeout"
  | "disk_full"
  | "high_cpu"
  | "high_latency"
  | "network_partition"
  | "wal_corruption"
  | "sstable_corruption"
  | "readonly_disk";

// ── Active failure on a node ────────────────────────────────────────────────
export interface NodeFailure {
  nodeId: number;
  type: FailureType;
  startedAt: number; // Date.now()
  label: string;
}

// ── Network partition between two nodes ─────────────────────────────────────
export interface NetworkPartition {
  from: number;
  to: number;
  startedAt: number;
}

// ── Event bus payload types ─────────────────────────────────────────────────
export type ClusterEventType =
  | "NODE_STATE_CHANGED"
  | "FAILURE_INJECTED"
  | "NODE_RECOVERED"
  | "PARTITION_CREATED"
  | "PARTITION_HEALED"
  | "REBALANCE_STARTED"
  | "REBALANCE_COMPLETED";

export interface ClusterEvent {
  type: ClusterEventType;
  nodeId?: number;
  nodeState?: NodeState;
  failure?: NodeFailure;
  partition?: NetworkPartition;
  message: string;
  timestamp: number;
}

// ── Per-node runtime state ───────────────────────────────────────────────────
export interface NodeRuntimeState {
  id: number;
  name: string;
  state: NodeState;
  activeFailure?: NodeFailure;
  lagMs?: number;          // replication lag in ms — spikes on failure
  cpuBoost?: number;       // extra CPU from high_cpu failure
}

export const FAILURE_LABELS: Record<FailureType, string> = {
  node_crash:         "Node Crash",
  heartbeat_timeout:  "Heartbeat Timeout",
  disk_full:          "Disk Full",
  high_cpu:           "High CPU",
  high_latency:       "High Latency",
  network_partition:  "Network Partition",
  wal_corruption:     "WAL Corruption",
  sstable_corruption: "SSTable Corruption",
  readonly_disk:      "Read-only Disk",
};

export const STATE_COLORS: Record<NodeState, { text: string; bg: string; border: string; dot: string }> = {
  HEALTHY:     { text: "text-green-400",  bg: "bg-green-950/50",  border: "border-green-700",  dot: "#4ade80" },
  SUSPECT:     { text: "text-yellow-400", bg: "bg-yellow-950/50", border: "border-yellow-700", dot: "#facc15" },
  UNREACHABLE: { text: "text-red-400",    bg: "bg-red-950/50",    border: "border-red-700",    dot: "#f87171" },
  RECOVERING:  { text: "text-blue-400",   bg: "bg-blue-950/50",   border: "border-blue-700",   dot: "#60a5fa" },
  REBALANCING: { text: "text-purple-400", bg: "bg-purple-950/50", border: "border-purple-700", dot: "#c084fc" },
};
