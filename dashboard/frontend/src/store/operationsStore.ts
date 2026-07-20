/**
 * operationsStore — Global background operations singleton.
 *
 * ▸ Owns ALL background task state — never tied to a page component.
 * ▸ Owns the polling loop for Generate Load (1000ms interval).
 * ▸ Persists running ops to sessionStorage so browser refresh restores them.
 * ▸ React hook: useOperations() / useOperation(id)
 *
 * ID format: "load-{timestamp}", "flush-{timestamp}", "snap-{timestamp}", etc.
 */

import { useState, useEffect } from "react";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface Operation {
  id: string;
  name: string;
  status: "running" | "completed" | "failed";
  progress: number;       // 0–100
  result?: string;        // "500W · 500R · 100D · 1.82s"
  error?: string;
  startedAt: number;      // Date.now()
  completedAt?: number;
}

type Listener = () => void;

// ── Singleton ──────────────────────────────────────────────────────────────────

const SESSION_KEY = "lsmkv-bg-ops";

class OperationsStore {
  private _ops: Map<string, Operation> = new Map();
  private _listeners: Set<Listener> = new Set();
  private _pollTimers: Map<string, ReturnType<typeof setInterval>> = new Map();
  // Completed ops purge timer
  private _purgeTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this._hydrate();
    this._startPurgeTimer();
  }

  // ── Subscription ────────────────────────────────────────────────────────────

  subscribe(fn: Listener): () => void {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  private _notify() {
    this._listeners.forEach((fn) => {
      try { fn(); } catch { /* isolate */ }
    });
  }

  // ── Reads ────────────────────────────────────────────────────────────────────

  getAll(): Operation[] {
    return Array.from(this._ops.values());
  }

  get(id: string): Operation | undefined {
    return this._ops.get(id);
  }

  /** Find the most recent running or completed load operation */
  getLoadOp(): Operation | undefined {
    const running = this.getAll().find(o => o.id.startsWith("load-") && o.status === "running");
    if (running) return running;
    return [...this._ops.values()]
      .filter(o => o.id.startsWith("load-"))
      .sort((a, b) => b.startedAt - a.startedAt)[0];
  }

  isLoadRunning(): boolean {
    return this.getAll().some(o => o.id.startsWith("load-") && o.status === "running");
  }

  // ── Mutations ────────────────────────────────────────────────────────────────

  start(id: string, name: string): void {
    const op: Operation = {
      id,
      name,
      status: "running",
      progress: 0,
      startedAt: Date.now(),
    };
    this._ops.set(id, op);
    this._persist();
    this._notify();
  }

  update(id: string, progress: number): void {
    const op = this._ops.get(id);
    if (!op || op.status !== "running") return;
    this._ops.set(id, { ...op, progress: Math.min(100, Math.max(0, progress)) });
    this._persist();
    this._notify();
  }

  complete(id: string, result: string): void {
    const op = this._ops.get(id);
    if (!op) return;
    this._ops.set(id, {
      ...op,
      status: "completed",
      progress: 100,
      result,
      completedAt: Date.now(),
    });
    this._stopPoll(id);
    this._persist();
    this._notify();
    // Fire toast event
    this._fireToast(op.name, result);
  }

  fail(id: string, error: string): void {
    const op = this._ops.get(id);
    if (!op) return;
    this._ops.set(id, {
      ...op,
      status: "failed",
      error,
      completedAt: Date.now(),
    });
    this._stopPoll(id);
    this._persist();
    this._notify();
  }

  // ── Load polling (owned here, survives navigation) ──────────────────────────

  startLoadPoll(id: string, totalOps: number): void {
    this._stopPoll(id); // prevent duplicates
    const timer = setInterval(async () => {
      try {
        const r = await fetch("/api/demo/load-status");
        if (!r.ok) return;
        const s = await r.json();
        const pct = totalOps > 0
          ? Math.min(99, Math.round((s.total_ops / totalOps) * 100))
          : 0;
        this.update(id, pct);
        if (!s.running) {
          const result = `${s.sets_ok}W · ${s.gets_ok}R · ${s.deletes_ok}D · ${(s.elapsed_ms / 1000).toFixed(2)}s`;
          this.complete(id, result);
          // Trigger global refresh
          import("../store/syncEngine").then(m => m.triggerRefresh());
        }
      } catch {
        /* backend offline — keep polling */
      }
    }, 1000);
    this._pollTimers.set(id, timer);
  }

  stopLoadPoll(id?: string): void {
    if (id) {
      this._stopPoll(id);
    } else {
      // Stop all load polls
      for (const [k] of this._pollTimers) {
        if (k.startsWith("load-")) this._stopPoll(k);
      }
    }
  }

  cancelLoadOp(): void {
    const running = this.getAll().find(o => o.id.startsWith("load-") && o.status === "running");
    if (!running) return;
    this._stopPoll(running.id);
    this._ops.set(running.id, {
      ...running,
      status: "failed",
      error: "Cancelled",
      completedAt: Date.now(),
    });
    this._persist();
    this._notify();
  }

  private _stopPoll(id: string): void {
    const timer = this._pollTimers.get(id);
    if (timer) { clearInterval(timer); this._pollTimers.delete(id); }
  }

  // ── sessionStorage persistence ───────────────────────────────────────────────

  private _persist(): void {
    try {
      const running = this.getAll().filter(o => o.status === "running");
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(running));
    } catch { /* storage full or unavailable */ }
  }

  private _hydrate(): void {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return;
      const ops: Operation[] = JSON.parse(raw);
      ops.forEach((op) => {
        this._ops.set(op.id, op);
        // Resume polling for load ops
        if (op.id.startsWith("load-") && op.status === "running") {
          // We don't know totalOps after refresh, use progress-based estimation
          this._resumeLoadPoll(op.id);
        }
      });
    } catch { /* corrupt storage */ }
  }

  private _resumeLoadPoll(id: string): void {
    this._stopPoll(id);
    const timer = setInterval(async () => {
      try {
        const r = await fetch("/api/demo/load-status");
        if (!r.ok) return;
        const s = await r.json();
        const op = this._ops.get(id);
        if (!op) { clearInterval(timer); return; }
        // Estimate progress from current vs expected
        const pct = s.total_ops > 0 ? Math.min(99, Math.round(s.total_ops / 10)) : op.progress;
        this.update(id, pct);
        if (!s.running) {
          const result = `${s.sets_ok}W · ${s.gets_ok}R · ${s.deletes_ok}D · ${(s.elapsed_ms / 1000).toFixed(2)}s`;
          this.complete(id, result);
          import("../store/syncEngine").then(m => m.triggerRefresh());
        }
      } catch { /* keep polling */ }
    }, 1000);
    this._pollTimers.set(id, timer);
  }

  // ── Completed ops purge (after 30s, remove from widget) ─────────────────────

  private _startPurgeTimer(): void {
    this._purgeTimer = setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const [id, op] of this._ops) {
        if (op.status !== "running" && op.completedAt && now - op.completedAt > 30_000) {
          this._ops.delete(id);
          changed = true;
        }
      }
      if (changed) this._notify();
    }, 5_000);
  }

  // ── Toast events ─────────────────────────────────────────────────────────────

  private _toastListeners: Set<(name: string, result: string) => void> = new Set();

  onToast(fn: (name: string, result: string) => void): () => void {
    this._toastListeners.add(fn);
    return () => this._toastListeners.delete(fn);
  }

  private _fireToast(name: string, result: string): void {
    this._toastListeners.forEach(fn => {
      try { fn(name, result); } catch { /* isolate */ }
    });
  }
}

export const operationsStore = new OperationsStore();

// ── React Hooks ───────────────────────────────────────────────────────────────

/** Subscribe to all operations — re-renders when any op changes. */
export function useOperations(): Operation[] {
  const [ops, setOps] = useState<Operation[]>(() => operationsStore.getAll());
  useEffect(() => {
    setOps(operationsStore.getAll());
    return operationsStore.subscribe(() => setOps(operationsStore.getAll()));
  }, []);
  return ops;
}

/** Subscribe to a specific operation by ID. */
export function useOperation(id: string): Operation | undefined {
  const ops = useOperations();
  return ops.find(o => o.id === id);
}

/** True when any load-* op is currently running. */
export function useLoadRunning(): boolean {
  const ops = useOperations();
  return ops.some(o => o.id.startsWith("load-") && o.status === "running");
}
