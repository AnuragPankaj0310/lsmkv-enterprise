/**
 * Snapshots — API-backed snapshot management.
 *
 * Wired to:
 *   GET    /snapshots              — list
 *   POST   /snapshots              — create
 *   POST   /snapshots/:id/restore  — restore
 *   DELETE /snapshots/:id          — delete
 */
import { useState, useEffect } from "react";
import SectionHeader from "../components/SectionHeader";
import { useCluster } from "../context/ClusterContext";
import { apiFetch } from "../api/client";
import { useClusterStore } from "../store/clusterStore";
import { triggerRefresh } from "../store/syncEngine";
import LiveBadge from "../components/LiveBadge";
import { startSnapshot, startRestoreSnapshot } from "../services/backgroundOps";

// ── Types ────────────────────────────────────────────────────────────────────
interface Snapshot {
  id: string;
  name: string;
  created_at: string;
  size_mb: number;
  status: "ready" | "creating" | "restoring";
  node_count: number;
}

// ── API helpers ──────────────────────────────────────────────────────────────
const snapshotApi = {
  list:    ()               => apiFetch<Snapshot[]>("/api/snapshots"),
  create:  (name: string)  => apiFetch<Snapshot>("/api/snapshots", { method: "POST", body: JSON.stringify({ name }), headers: { "Content-Type": "application/json" } }),
  restore: (id: string)    => apiFetch<{ ok: boolean; message: string; estimated_seconds: number }>(`/api/snapshots/${id}/restore`, { method: "POST" }),
  delete:  (id: string)    => apiFetch<{ ok: boolean }>(`/api/snapshots/${id}`, { method: "DELETE" }),
};

// ── Status pill ──────────────────────────────────────────────────────────────
function StatusPill({ status }: { status: Snapshot["status"] }) {
  if (status === "ready")
    return <span className="rounded-full bg-green-900/50 px-2 py-0.5 text-[10px] font-bold text-green-400 border border-green-800">READY</span>;
  if (status === "creating")
    return <span className="rounded-full bg-blue-900/50 px-2 py-0.5 text-[10px] font-bold text-blue-400 border border-blue-800 animate-pulse">CREATING…</span>;
  return <span className="rounded-full bg-yellow-900/50 px-2 py-0.5 text-[10px] font-bold text-yellow-400 border border-yellow-800 animate-pulse">RESTORING…</span>;
}

// ── Progress bar ─────────────────────────────────────────────────────────────
function ProgressBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
      <div
        className="h-1.5 rounded-full transition-all duration-200"
        style={{ width: `${pct}%`, backgroundColor: color }}
      />
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function Snapshots() {
  const { nodes: runtimeNodes } = useCluster();
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [name, setName] = useState("");

  // Read snapshot list from global store (set by syncEngine every 5s)
  const storeSnapshots = useClusterStore(s => s.snapshots);
  const connected      = useClusterStore(s => s.connected);

  useEffect(() => {
    if (storeSnapshots.length > 0) {
      // Merge store data — preserve local optimistic entries (creating/restoring)
      setSnapshots(prev => {
        const optimistic = prev.filter(p => p.status === "creating" || p.status === "restoring");
        const fromStore = storeSnapshots.map(s => ({ ...s } as Snapshot));
        const merged = [...fromStore];
        // Reinsert optimistic entries that aren't yet in store
        optimistic.forEach(o => {
          if (!merged.find(m => m.id === o.id)) merged.unshift(o);
        });
        return merged;
      });
    }
  }, [storeSnapshots]);

  // Local UI animation state
  const [creating, setCreating] = useState(false);
  const [createProgress, setCreateProgress] = useState(0);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [restoreProgress, setRestoreProgress] = useState(0);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  }

  // ── Create snapshot ────────────────────────────────────────────────────────
  async function handleCreate() {
    if (!name.trim() || creating) return;
    const snapName = name.trim();
    setCreating(true);
    setCreateProgress(0);

    const tick = setInterval(() => {
      setCreateProgress((p) => Math.min(p + 6, 90));
    }, 120);

    try {
      const snap = await snapshotApi.create(snapName);
      clearInterval(tick);
      setCreateProgress(100);
      // Also register in global ops store (visible from all pages)
      startSnapshot(snapName);
      setTimeout(() => {
        setSnapshots((prev) => [snap, ...prev]);
        setCreating(false);
        setCreateProgress(0);
        setName("");
        showToast(`✅ Snapshot "${snap.name}" created`);
        triggerRefresh();
      }, 400);
    } catch (e: unknown) {
      clearInterval(tick);
      setCreating(false);
      setCreateProgress(0);
      showToast(`❌ Create failed: ${e instanceof Error ? e.message : "Unknown error"}`, false);
    }
  }

  // ── Restore snapshot ───────────────────────────────────────────────────────
  async function handleRestore(id: string) {
    if (restoringId) return;
    const snap = snapshots.find(s => s.id === id);
    setRestoringId(id);
    setRestoreProgress(0);
    // Register in global ops store
    if (snap) startRestoreSnapshot(snap.name);

    try {
      const res = await snapshotApi.restore(id);
      const totalMs = (res.estimated_seconds ?? 8) * 1000;
      const step = 100 / (totalMs / 80);
      const tick = setInterval(() => {
        setRestoreProgress((p) => {
          if (p >= 100) {
            clearInterval(tick);
            setRestoringId(null);
            setRestoreProgress(0);
            showToast(`✅ ${res.message}`);
            return 0;
          }
          return Math.min(p + step, 100);
        });
      }, 80);
    } catch (e: unknown) {
      setRestoringId(null);
      showToast(`❌ Restore failed: ${e instanceof Error ? e.message : "Unknown error"}`, false);
    }
  }

  // ── Delete snapshot ────────────────────────────────────────────────────────
  async function handleDelete(id: string, snapName: string) {
    setDeletingId(id);
    try {
      await snapshotApi.delete(id);
      setSnapshots((prev) => prev.filter((s) => s.id !== id));
      if (selected === id) setSelected(null);
      showToast(`🗑 Snapshot "${snapName}" deleted`);
      triggerRefresh();
    } catch (e: unknown) {
      showToast(`❌ Delete failed: ${e instanceof Error ? e.message : "Unknown error"}`, false);
    } finally {
      setDeletingId(null);
    }
  }


  // ── Selected snapshot detail ───────────────────────────────────────────────
  const selectedSnap = snapshots.find((s) => s.id === selected);

  // ── Derived stats ──────────────────────────────────────────────────────────
  const totalSizeMb = snapshots.reduce((s, n) => s + n.size_mb, 0);
  const readyCount = snapshots.filter((s) => s.status === "ready").length;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <SectionHeader
          title="Snapshots"
          subtitle={
            connected
              ? `🟢 API connected · ${runtimeNodes.length} nodes · ${snapshots.length} snapshots`
              : `🔴 Backend offline · showing cached data`
          }
        />
        {/* Stats strip + LiveBadge */}
        <div className="flex items-center gap-4">
          <LiveBadge refreshLabel="5 sec" />
          <div className="flex gap-4 text-right">
            <div>
              <div className="text-lg font-black text-green-400">{readyCount}</div>
              <div className="text-[10px] text-zinc-600 uppercase">Ready</div>
            </div>
            <div>
              <div className="text-lg font-black text-zinc-300">{totalSizeMb.toFixed(1)}</div>
              <div className="text-[10px] text-zinc-600 uppercase">MB total</div>
            </div>
            <div>
              <div className="text-lg font-black text-blue-400">{runtimeNodes.length}</div>
              <div className="text-[10px] text-zinc-600 uppercase">Nodes</div>
            </div>
          </div>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`rounded-lg border px-4 py-2.5 text-sm font-semibold transition-all ${
          toast.ok
            ? "border-green-800 bg-green-950/30 text-green-400"
            : "border-red-800 bg-red-950/30 text-red-400"
        }`}>
          {toast.msg}
        </div>
      )}

      {/* Two-column layout */}
      <div className="grid grid-cols-5 gap-6">

        {/* ── Left: Snapshot list ── */}
        <div className="col-span-3 space-y-3">
          {snapshots.length === 0 && !creating && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/20 p-8 text-center text-zinc-600 space-y-2">
              <div className="text-2xl">📦</div>
              <div className="text-sm font-semibold">No snapshots yet</div>
              <div className="text-xs">Create a snapshot to save the current cluster state.</div>
            </div>
          )}

          {snapshots.map((snap) => {
            const isRestoring = restoringId === snap.id;
            const isDeleting  = deletingId  === snap.id;
            const isSelected  = selected    === snap.id;
            return (
              <div
                key={snap.id}
                onClick={() => setSelected(isSelected ? null : snap.id)}
                className={`rounded-xl border p-4 cursor-pointer transition-all hover:border-zinc-600 ${
                  isSelected
                    ? "border-blue-700 bg-blue-950/20"
                    : "border-zinc-800 bg-zinc-900/40"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-bold text-white truncate">{snap.name}</span>
                      <StatusPill status={isRestoring ? "restoring" : snap.status} />
                    </div>
                    <div className="flex gap-3 text-[11px] text-zinc-500 font-mono">
                      <span>{snap.id}</span>
                      <span>·</span>
                      <span>{new Date(snap.created_at).toLocaleString()}</span>
                      <span>·</span>
                      <span>{snap.size_mb.toFixed(1)} MB</span>
                      <span>·</span>
                      <span>{snap.node_count} nodes</span>
                    </div>
                    {isRestoring && (
                      <div className="mt-2">
                        <ProgressBar pct={restoreProgress} color="#facc15" />
                        <div className="text-[10px] text-yellow-500 mt-1">Restoring… {Math.round(restoreProgress)}%</div>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleRestore(snap.id); }}
                      disabled={!!restoringId || snap.status !== "ready"}
                      className="rounded-lg border border-yellow-800 bg-yellow-950/30 px-3 py-1.5 text-xs font-bold text-yellow-400 hover:bg-yellow-900/40 transition disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      ↺ Restore
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(snap.id, snap.name); }}
                      disabled={isDeleting || !!restoringId}
                      className="rounded-lg border border-red-900 bg-red-950/20 px-3 py-1.5 text-xs font-bold text-red-400 hover:bg-red-900/30 transition disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {isDeleting ? "…" : "✕"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Right: Detail + Create ── */}
        <div className="col-span-2 space-y-4">

          {/* Create panel */}
          <div className="rounded-xl border border-zinc-700 bg-zinc-900/60 p-4 space-y-3">
            <h3 className="text-sm font-bold text-zinc-300 uppercase tracking-wider">Create Snapshot</h3>
            <input
              type="text"
              placeholder="Snapshot name…"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              disabled={creating}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 disabled:opacity-50"
            />
            {creating && (
              <ProgressBar pct={createProgress} color="#60a5fa" />
            )}
            <button
              onClick={handleCreate}
              disabled={creating || !name.trim()}
              className="w-full rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 px-4 py-2 text-sm font-bold text-white transition"
            >
              {creating ? `Creating… ${Math.round(createProgress)}%` : "📸 Create Snapshot"}
            </button>
            <p className="text-[10px] text-zinc-600">
              Saves current cluster state: all {runtimeNodes.length} node(s), key distribution, SSTable layout.
            </p>
          </div>

          {/* Selected snapshot detail */}
          {selectedSnap ? (
            <div className="rounded-xl border border-zinc-700 bg-zinc-900/60 p-4 space-y-3">
              <h3 className="text-sm font-bold text-zinc-300 uppercase tracking-wider">Snapshot Details</h3>
              <div className="space-y-2 text-xs font-mono">
                {[
                  ["ID", selectedSnap.id],
                  ["Name", selectedSnap.name],
                  ["Created", new Date(selectedSnap.created_at).toLocaleString()],
                  ["Size", `${selectedSnap.size_mb.toFixed(2)} MB`],
                  ["Nodes captured", String(selectedSnap.node_count)],
                  ["Status", selectedSnap.status.toUpperCase()],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2">
                    <span className="text-zinc-600">{k}</span>
                    <span className="text-zinc-300 text-right truncate max-w-[140px]">{v}</span>
                  </div>
                ))}
              </div>
              <div className="border-t border-zinc-800 pt-3 space-y-1 text-[10px] text-zinc-600">
                <div>Restoring will:</div>
                <ul className="list-disc ml-4 space-y-0.5">
                  <li>Stop the cluster</li>
                  <li>Replace SSTable files</li>
                  <li>Replay WAL from snapshot point</li>
                  <li>Restart all nodes</li>
                </ul>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/20 p-4 text-center text-zinc-600 text-xs">
              Click a snapshot to see details
            </div>
          )}

          {/* Cluster node status */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-2">
            <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Node Status</h3>
            {runtimeNodes.map((n) => {
              const healthy = n.state === "HEALTHY";
              const color = healthy ? "#4ade80" : n.state === "UNREACHABLE" ? "#f87171" : "#facc15";
              return (
                <div key={n.id} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
                    <span className="text-zinc-400 font-mono">node{n.id}</span>
                  </div>
                  <span className="font-bold" style={{ color }}>{n.state}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}