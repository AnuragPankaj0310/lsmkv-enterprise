/** Cluster-level overview returned by GET /cluster */
export interface ClusterInfo {
  node_count: number;
  key_count: number;
  replication_factor: number;
  virtual_nodes: number;
  uptime_seconds: number;
  status: "healthy" | "degraded" | "critical";
}

/** Per-node detail returned by GET /nodes */
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
}
