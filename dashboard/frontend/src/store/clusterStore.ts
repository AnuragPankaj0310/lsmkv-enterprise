/**
 * clusterStore — Module-level singleton that holds ALL backend cluster state.
 *
 * Why module-level and not React context?
 *   Navigation (unmounting pages) does NOT reset this store.
 *   Every page reads the same persisted state immediately on mount.
 *
 * Usage:
 *   import { clusterStore, useClusterStore } from "../store/clusterStore";
 *
 *   // Inside a component:
 *   const nodeInfos = useClusterStore(s => s.nodeInfos);
 *   const connected = useClusterStore(s => s.connected);
 *
 *   // Outside React:
 *   clusterStore.getState()
 *   clusterStore.setState({ nodeInfos: [...] })
 */
import { useState, useEffect, useRef } from "react";
import type { ClusterInfo, NodeInfo } from "../api/cluster";
import type { ReplicationStatus } from "../api/live";
import type { NodeStorage } from "../types/storage";

// ── Snapshot type (mirrors Snapshots page definition) ────────────────────────
export interface SnapshotRecord {
  id: string;
  name: string;
  created_at: string;
  size_mb: number;
  status: "ready" | "creating" | "restoring";
  node_count: number;
}

// ── Full store shape ──────────────────────────────────────────────────────────
export interface ClusterStoreState {
  clusterInfo:       ClusterInfo | null;
  nodeInfos:         NodeInfo[];
  replicationData:   ReplicationStatus | null;
  storageData:       NodeStorage[];
  snapshots:         SnapshotRecord[];
  lastSyncAt:        number | null;
  lastSyncEpoch:     number;          // incrementing counter — pages use this to detect changes
  connected:         boolean;
}

type Listener = (state: ClusterStoreState) => void;

// ── Store class ───────────────────────────────────────────────────────────────
class ClusterStore {
  private _state: ClusterStoreState = {
    clusterInfo:     null,
    nodeInfos:       [],
    replicationData: null,
    storageData:     [],
    snapshots:       [],
    lastSyncAt:      null,
    lastSyncEpoch:   0,
    connected:       false,
  };

  private _listeners = new Set<Listener>();

  getState(): ClusterStoreState {
    return this._state;
  }

  setState(partial: Partial<ClusterStoreState>): void {
    this._state = { ...this._state, ...partial };
    this._listeners.forEach(fn => {
      try { fn(this._state); } catch { /* isolate */ }
    });
  }

  /** Register a listener. Returns an unsubscribe function. */
  subscribe(fn: Listener): () => void {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }
}

/** Singleton — import everywhere, never instantiate a second one. */
export const clusterStore = new ClusterStore();

// ── React hook ────────────────────────────────────────────────────────────────

/**
 * useClusterStore<T>(selector)
 *
 * Subscribe to the global cluster store and re-render whenever the selected
 * value changes. Persists across navigation — the store is never cleared.
 *
 * @example
 *   const connected  = useClusterStore(s => s.connected);
 *   const nodeInfos  = useClusterStore(s => s.nodeInfos);
 *   const snapshots  = useClusterStore(s => s.snapshots);
 */
export function useClusterStore<T>(selector: (s: ClusterStoreState) => T): T {
  const selectorRef = useRef(selector);
  selectorRef.current = selector;

  const [val, setVal] = useState<T>(() => selector(clusterStore.getState()));

  useEffect(() => {
    // Re-read immediately in case the store changed between render and effect
    setVal(selectorRef.current(clusterStore.getState()));

    return clusterStore.subscribe(state => {
      setVal(selectorRef.current(state));
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return val;
}
