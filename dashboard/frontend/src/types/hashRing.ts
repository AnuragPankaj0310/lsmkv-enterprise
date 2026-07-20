export interface RingNode {
  id: number;
  angle: number;
  /** Physical address e.g. "node0:7001" — present when data comes from the backend */
  addr?: string;
}

export interface RingKey {
  id: number;
  angle: number;
  /** Owner node address — present when data comes from the backend */
  owner?: string;
}

/**
 * Full ring snapshot returned by GET /ring.
 * The frontend uses this for both mock and live data.
 */
export interface RingSnapshot {
  nodes: RingNode[];
  keys: RingKey[];
  replication_factor?: number;
  virtual_nodes?: number;
}
