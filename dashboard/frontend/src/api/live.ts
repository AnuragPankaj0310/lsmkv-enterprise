import { apiFetch } from "./client";
import type { NodeStorage } from "../types/storage";

export interface ReplicationStatus {
  replication_factor: number;
  quorum: number;
  nodes: {
    id: number;
    name: string;
    addr: string;
    role: "primary" | "replica";
    lag_ms: number;
    synced: boolean;
  }[];
}

export interface LogEntry {
  id: number;
  ts: string;
  level: "DEBUG" | "INFO" | "WARN" | "ERROR" | "SUCCESS";
  node: string;
  component: string;
  message: string;
}

/** GET /api/replication */
export async function getReplication(): Promise<ReplicationStatus> {
  return apiFetch<ReplicationStatus>("/api/replication");
}

/** GET /api/logs?limit=N */
export async function getLogs(limit = 50): Promise<LogEntry[]> {
  return apiFetch<LogEntry[]>(`/api/logs?limit=${limit}`);
}

/** GET /api/storage */
export async function getStorage(): Promise<NodeStorage[]> {
  return apiFetch<NodeStorage[]>("/api/storage");
}
