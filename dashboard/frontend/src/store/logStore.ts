/**
 * logStore — Global persistent log buffer singleton.
 *
 * ▸ Survives page navigation — Logs page reads from here on mount.
 * ▸ Written to by:
 *     1. useLogGenerator hook (background ticker in DashboardLayout)
 *     2. Logs page WS stream
 *     3. eventBus cluster events
 * ▸ Max 300 entries (rolling).
 */

import { useState, useEffect } from "react";

// ── Types (mirrors Logs.tsx LogEntry, kept minimal to avoid circular deps) ────

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR" | "SUCCESS";
export type LogComponent =
  | "WAL" | "REPLICATION" | "COMPACTION" | "SNAPSHOT"
  | "HEARTBEAT" | "ELECTION" | "STORAGE" | "CLUSTER";

export interface LogEntry {
  id: number;
  ts: string;
  level: LogLevel;
  node: string;
  component: LogComponent;
  message: string;
  isNew?: boolean;
}

// ── Singleton ──────────────────────────────────────────────────────────────────

const MAX_ENTRIES = 300;
let _nextId = 1;

class LogStore {
  private _entries: LogEntry[] = [];
  private _listeners: Set<() => void> = new Set();

  subscribe(fn: () => void): () => void {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  private _notify() {
    this._listeners.forEach(fn => { try { fn(); } catch { /* isolate */ } });
  }

  push(entry: Omit<LogEntry, "id">): void {
    const full: LogEntry = { ...entry, id: _nextId++ };
    this._entries = [...this._entries, full].slice(-MAX_ENTRIES);
    this._notify();
  }

  pushMany(entries: Omit<LogEntry, "id">[]): void {
    const stamped = entries.map(e => ({ ...e, id: _nextId++ }));
    this._entries = [...this._entries, ...stamped].slice(-MAX_ENTRIES);
    this._notify();
  }

  getAll(): LogEntry[] {
    return this._entries;
  }

  /** Seed initial entries (called once from backend fetch) */
  seed(entries: LogEntry[]): void {
    if (this._entries.length === 0) {
      this._entries = entries.slice(-MAX_ENTRIES);
      this._notify();
    }
  }

  /** Clear all log entries */
  clear(): void {
    this._entries = [];
    this._notify();
  }
}

export const logStore = new LogStore();

// ── React Hook ────────────────────────────────────────────────────────────────

export function useLogStore(): LogEntry[] {
  const [entries, setEntries] = useState<LogEntry[]>(() => logStore.getAll());
  useEffect(() => {
    setEntries(logStore.getAll());
    return logStore.subscribe(() => setEntries(logStore.getAll()));
  }, []);
  return entries;
}
