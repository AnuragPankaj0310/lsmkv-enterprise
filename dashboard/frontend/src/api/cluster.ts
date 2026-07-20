import { apiFetch } from "./client";

export interface ClusterInfo {
  node_count: number;
  key_count: number;
  replication_factor: number;
  virtual_nodes: number;
  uptime_seconds: number;
  status: "healthy" | "degraded" | "critical";
}

export interface NodeInfo {
  id: number;
  addr: string;
  host: string;
  port: number;
  status: "healthy" | "dead" | "unknown";
  key_count: number;
  memtable_mb: number;
  wal_mb: number;
  disk_mb: number;
  angle: number;
  metrics_live?: boolean;
}

/** GET /api/cluster — high-level cluster overview */
export async function getCluster(): Promise<ClusterInfo> {
  return apiFetch<ClusterInfo>("/api/cluster");
}

/** GET /api/nodes — per-node status and storage stats */
export async function getNodes(): Promise<NodeInfo[]> {
  return apiFetch<NodeInfo[]>("/api/nodes");
}
