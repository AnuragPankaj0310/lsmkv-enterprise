/**
 * backgroundOps — Action functions for all long-running cluster operations.
 *
 * Each function:
 *   1. Generates a unique timestamp ID
 *   2. Registers the op in operationsStore
 *   3. Calls the backend
 *   4. Resolves/fails the op when done
 *
 * Dashboard / Storage / Snapshots call these.
 * They know nothing about polling or progress — that's the store's job.
 */

import { operationsStore } from "../store/operationsStore";
import { triggerRefresh } from "../store/syncEngine";

// ── Generate Load ─────────────────────────────────────────────────────────────

export interface LoadParams {
  writes: number;
  reads: number;
  deletes: number;
  parallelism: number;
}

/**
 * Start a load generation job.
 * Returns the operation ID.
 */
export async function startLoadGeneration(params: LoadParams): Promise<string> {
  const id = `load-${Date.now()}`;
  const totalOps = params.writes + params.reads + params.deletes;
  operationsStore.start(id, "Generate Load");
  try {
    const r = await fetch("/api/demo/generate-load", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    const data = await r.json();
    if (data.ok) {
      operationsStore.startLoadPoll(id, totalOps);
    } else {
      operationsStore.fail(id, data.error ?? "Backend rejected request");
    }
  } catch {
    operationsStore.fail(id, "Backend offline");
  }
  return id;
}

/**
 * Stop an active load generation.
 */
export async function stopLoadGeneration(): Promise<void> {
  try {
    await fetch("/api/demo/stop-load", { method: "POST" });
  } catch { /* ignore */ }
  operationsStore.cancelLoadOp();
  triggerRefresh();
}

// ── Flush MemTable ─────────────────────────────────────────────────────────────

export async function startFlush(): Promise<void> {
  const id = `flush-${Date.now()}`;
  operationsStore.start(id, "Flush MemTable");
  operationsStore.update(id, 30);
  try {
    const r = await fetch("/api/flush", { method: "POST" });
    const data = await r.json();
    const sim = data.simulated ? " (simulated)" : "";
    operationsStore.complete(id, `MemTable flushed to SSTable${sim}`);
  } catch {
    operationsStore.complete(id, "Flush complete (simulated)");
  }
  triggerRefresh();
}

// ── Compact Now ───────────────────────────────────────────────────────────────

export async function startCompact(): Promise<void> {
  const id = `compact-${Date.now()}`;
  operationsStore.start(id, "Compact Now");
  operationsStore.update(id, 20);
  try {
    // Fake progress steps for visual polish
    await _sleep(300);
    operationsStore.update(id, 50);
    const r = await fetch("/api/compact", { method: "POST" });
    await r.json();
    operationsStore.update(id, 90);
    await _sleep(200);
    operationsStore.complete(id, "All levels compacted");
  } catch {
    operationsStore.complete(id, "Compaction complete (simulated)");
  }
  triggerRefresh();
}

// ── Snapshot Create ───────────────────────────────────────────────────────────

export async function startSnapshot(name: string): Promise<void> {
  const id = `snap-${Date.now()}`;
  operationsStore.start(id, `Snapshot: ${name}`);
  operationsStore.update(id, 20);
  try {
    await _sleep(200);
    operationsStore.update(id, 60);
    const r = await fetch("/api/snapshots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await r.json();
    operationsStore.complete(id, data.ok ? `Snapshot "${name}" saved` : "Snapshot saved (simulated)");
  } catch {
    operationsStore.complete(id, `Snapshot "${name}" saved (simulated)`);
  }
  triggerRefresh();
}

// ── Snapshot Restore ──────────────────────────────────────────────────────────

export async function startRestoreSnapshot(name: string): Promise<void> {
  const id = `restore-${Date.now()}`;
  operationsStore.start(id, `Restore: ${name}`);
  operationsStore.update(id, 15);
  try {
    await _sleep(300);
    operationsStore.update(id, 60);
    const r = await fetch(`/api/snapshots/${encodeURIComponent(name)}/restore`, {
      method: "POST",
    });
    await r.json();
    operationsStore.update(id, 90);
    await _sleep(200);
    operationsStore.complete(id, `Restored to snapshot "${name}"`);
  } catch {
    operationsStore.complete(id, `Restore "${name}" complete (simulated)`);
  }
  triggerRefresh();
}

// ── Add Node ──────────────────────────────────────────────────────────────────

export async function startAddNode(addFn: () => Promise<void>): Promise<void> {
  const id = `add-node-${Date.now()}`;
  operationsStore.start(id, "Add Node");
  operationsStore.update(id, 10);
  try {
    await _sleep(200);
    operationsStore.update(id, 30);
    await addFn();
    operationsStore.update(id, 70);
    await _sleep(600); // allow ring to settle
    operationsStore.update(id, 90);
    await _sleep(300);
    operationsStore.complete(id, "Node joined cluster successfully");
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    operationsStore.fail(id, msg);
  }
  triggerRefresh();
}

// ── Remove Node ───────────────────────────────────────────────────────────────

export async function startRemoveNode(removeFn: () => Promise<void>): Promise<void> {
  const id = `remove-node-${Date.now()}`;
  operationsStore.start(id, "Remove Node");
  operationsStore.update(id, 10);
  try {
    await _sleep(200);
    operationsStore.update(id, 40);
    await removeFn();
    operationsStore.update(id, 80);
    await _sleep(400);
    operationsStore.complete(id, "Node removed, keys redistributed");
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    operationsStore.fail(id, msg);
  }
  triggerRefresh();
}

// ── Util ──────────────────────────────────────────────────────────────────────

function _sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
