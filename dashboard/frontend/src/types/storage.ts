/** SSTable level entry for Storage page */
export interface SSTableLevel {
  level: number;
  count: number;
  sizeMb: number;
}

/** Per-node storage statistics */
export interface NodeStorage {
  id: number;
  name: string;
  port: number;
  color: string;
  hex: string;
  // null = not exported or backend offline
  key_count: number | null;
  memtable: { size: number | null; entries: number | null; maxMb: number };
  wal: { size: number | null; segments: number | null };
  sstables: SSTableLevel[];
  compactionQueue: number | null;
  compaction_runs: number | null;
  bloom_hit_rate: number | null;       // 0-100 percentage
  write_amplification: number | null;
  read_amplification: number | null;
  totalDisk: number | null;
}

/** Snapshot entry returned by GET /snapshots */
export interface SnapshotEntry {
  id: string;
  name: string;
  created_at: string;
  size_mb: number;
  status: "ready" | "creating" | "failed";
  node_count: number;
}
