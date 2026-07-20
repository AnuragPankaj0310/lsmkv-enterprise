/**
 * syncEngine — Global polling engine for the cluster dashboard.
 *
 * Architecture:
 *   DashboardLayout (never unmounts) calls useSyncEngine() once.
 *   This creates a 5-second polling loop that keeps the clusterStore fresh.
 *   Dashboard actions call triggerRefresh() for immediate propagation.
 *
 * Pages subscribe to clusterStore — they never poll independently.
 */
import { useEffect } from "react";
import { getCluster, getNodes } from "../api/cluster";
import { getReplication, getStorage } from "../api/live";
import { apiFetch } from "../api/client";
import { clusterStore } from "./clusterStore";
import type { SnapshotRecord } from "./clusterStore";
import type { NodeStorage } from "../types/storage";

const POLL_INTERVAL_MS = 5000;

// Registry of all active refresh callbacks (one per mounted DashboardLayout)
const _refreshers: Array<() => void> = [];

/**
 * triggerRefresh() — Call this after any Dashboard action to immediately
 * propagate changes to all subscribed pages.
 *
 * Example:
 *   await handleAddNode();
 *   triggerRefresh();
 */
export function triggerRefresh(): void {
  _refreshers.forEach(fn => {
    try { fn(); } catch { /* isolate */ }
  });
}

// ── Core fetch ────────────────────────────────────────────────────────────────

async function doRefresh(): Promise<void> {
  try {
    // Fetch all data in parallel — individual failures don't block others
    const [
      clusterResult,
      nodesResult,
      replicationResult,
      storageResult,
      snapshotsResult,
    ] = await Promise.allSettled([
      getCluster(),
      getNodes(),
      getReplication(),
      getStorage(),
      apiFetch<SnapshotRecord[]>("/api/snapshots"),
    ]);

    const now = Date.now();

    // Merge successful results into the store — preserve existing values on failure
    const current = clusterStore.getState();

    clusterStore.setState({
      clusterInfo:     clusterResult.status     === "fulfilled" ? clusterResult.value     : current.clusterInfo,
      nodeInfos:       nodesResult.status       === "fulfilled" ? nodesResult.value       : current.nodeInfos,
      replicationData: replicationResult.status === "fulfilled" ? replicationResult.value : current.replicationData,
      storageData:     storageResult.status     === "fulfilled"
        ? (storageResult.value as NodeStorage[]).map(n => ({
            ...n,
            color: NODE_COLORS[n.id]?.color ?? "bg-zinc-400",
            hex:   NODE_COLORS[n.id]?.hex   ?? "#a1a1aa",
          }))
        : current.storageData,
      snapshots:       snapshotsResult.status   === "fulfilled" ? snapshotsResult.value   : current.snapshots,
      lastSyncAt:      now,
      lastSyncEpoch:   current.lastSyncEpoch + 1,
      connected:       clusterResult.status === "fulfilled",
    });
  } catch {
    clusterStore.setState({ connected: false });
  }
}

// Node color map (keep in sync with Storage.tsx / Cluster.tsx)
const NODE_COLORS: Record<number, { color: string; hex: string }> = {
  0: { color: "bg-blue-400",   hex: "#60a5fa" },
  1: { color: "bg-green-400",  hex: "#4ade80" },
  2: { color: "bg-yellow-400", hex: "#facc15" },
  3: { color: "bg-purple-400", hex: "#c084fc" },
  4: { color: "bg-pink-400",   hex: "#f472b6" },
  5: { color: "bg-cyan-400",   hex: "#2dd4bf" },
};

// ── React hook ────────────────────────────────────────────────────────────────

/**
 * useSyncEngine() — Mount this exactly ONCE in DashboardLayout.
 *
 * Creates the 5-second polling loop and registers a triggerRefresh handler.
 * Cleans up automatically when DashboardLayout unmounts (app exit).
 */
export function useSyncEngine(): void {
  useEffect(() => {
    let mounted = true;

    function refresh() {
      if (mounted) doRefresh();
    }

    // Register so triggerRefresh() can reach this instance
    _refreshers.push(refresh);

    // Immediate first fetch
    refresh();

    // 5-second poll
    const t = setInterval(refresh, POLL_INTERVAL_MS);

    return () => {
      mounted = false;
      clearInterval(t);
      const idx = _refreshers.indexOf(refresh);
      if (idx !== -1) _refreshers.splice(idx, 1);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
