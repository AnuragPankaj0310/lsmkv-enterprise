/** Replication node role */
export type NodeRole = "primary" | "replica";

/** Per-node replication status */
export interface ReplicationNode {
  id: number;
  name: string;
  role: NodeRole;
  hex: string;
  lag_ms: number;
  keys: number;
  synced: boolean;
}

/** Replication factor config */
export interface ReplicationConfig {
  rf: number;
  quorum_writes: number;
  quorum_reads: number;
}
