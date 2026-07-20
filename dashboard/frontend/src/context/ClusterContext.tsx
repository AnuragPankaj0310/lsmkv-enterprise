import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  type ReactNode,
  useEffect,
} from "react";
import type {
  NodeRuntimeState,
  NetworkPartition,
  FailureType,
} from "../types/failure";
import { injectFailure, recoverNode, createPartition, healPartition } from "../services/simulation";
import { getNodes } from "../api/cluster";

// ── Snapshot type for Timeline Replay ────────────────────────────────────────
export interface ClusterSnapshot {
  time: number;           // epoch ms
  nodes: NodeRuntimeState[];
  partitions: NetworkPartition[];
  label: string;          // human-readable event label
}

// ── Context shape ────────────────────────────────────────────────────────────

interface ClusterContextValue {
  /** Current runtime state of every node */
  nodes: NodeRuntimeState[];
  /** Active network partitions */
  partitions: NetworkPartition[];

  /** Actions dispatched from ChaosEngineering page */
  dispatchFailure: (nodeId: number, type: FailureType) => void;
  dispatchRecover: (nodeId: number) => void;
  dispatchPartition: (from: number, to: number) => void;
  dispatchHealPartition: (from: number, to: number) => void;
  dispatchRecoverAll: () => void;

  /** Dynamic Cluster Scaling */
  addNode: () => Promise<void>;
  removeNode: () => Promise<void>;
  scaleKeys: (delta: number) => Promise<void>;

  /** Convenience query */
  isPartitioned: (a: number, b: number) => boolean;

  /** Timeline Replay */
  history: ClusterSnapshot[];
  replayMode: boolean;
  replayIndex: number | null;
  startReplay: (index: number) => void;
  stopReplay: () => void;
  stepReplay: (delta: number) => void;
  recordSnapshot: (label: string) => void;
}

// ── Context creation ─────────────────────────────────────────────────────────

const ClusterContext = createContext<ClusterContextValue | null>(null);

export function useCluster(): ClusterContextValue {
  const ctx = useContext(ClusterContext);
  if (!ctx) throw new Error("useCluster must be used inside <ClusterProvider>");
  return ctx;
}

// ── Provider ─────────────────────────────────────────────────────────────────

export function ClusterProvider({ children }: { children: ReactNode }) {
  const [nodes, setNodes] = useState<NodeRuntimeState[]>([
    { id: 0, name: "node0", state: "HEALTHY", lagMs: 1, cpuBoost: 0 },
    { id: 1, name: "node1", state: "HEALTHY", lagMs: 1.8, cpuBoost: 0 },
    { id: 2, name: "node2", state: "HEALTHY", lagMs: 2.6, cpuBoost: 0 },
  ]);
  const [partitions, setPartitions] = useState<NetworkPartition[]>([]);

  // Timeline history ring buffer (max 200 snapshots)
  const [history, setHistory] = useState<ClusterSnapshot[]>([]);
  const [replayMode, setReplayMode] = useState(false);
  const [replayIndex, setReplayIndex] = useState<number | null>(null);
  // When replaying, these override the live nodes/partitions
  const [replaySnapshot, setReplaySnapshot] = useState<ClusterSnapshot | null>(null);

  const MAX_HISTORY = 200;

  // Snapshot recorder — callable from anywhere
  const recordSnapshot = useCallback((label: string) => {
    setHistory((prev) => {
      const snap: ClusterSnapshot = {
        time: Date.now(),
        nodes: [...nodes],
        partitions: [...partitions],
        label,
      };
      const next = [...prev, snap];
      return next.length > MAX_HISTORY ? next.slice(-MAX_HISTORY) : next;
    });
  }, [nodes, partitions]);

  // Auto-record snapshot every 5s
  useEffect(() => {
    const t = setInterval(() => recordSnapshot("periodic"), 5000);
    return () => clearInterval(t);
  }, [recordSnapshot]);

  // Record snapshot on node state changes
  useEffect(() => {
    recordSnapshot("state-change");
  }, [JSON.stringify(nodes.map(n => n.state)), JSON.stringify(partitions)]);

  // Replay controls
  const startReplay = useCallback((index: number) => {
    setReplayMode(true);
    setReplayIndex(index);
    setReplaySnapshot((prev) => {
      // Will be set by setHistory effect
      return prev;
    });
  }, []);

  const stopReplay = useCallback(() => {
    setReplayMode(false);
    setReplayIndex(null);
    setReplaySnapshot(null);
  }, []);

  const stepReplay = useCallback((delta: number) => {
    setReplayIndex((prev) => {
      if (prev === null) return null;
      return prev;
    });
    setHistory((hist) => {
      setReplayIndex((prev) => {
        if (prev === null) return null;
        const next = Math.max(0, Math.min(hist.length - 1, prev + delta));
        setReplaySnapshot(hist[next] ?? null);
        return next;
      });
      return hist;
    });
  }, []);

  // When replayIndex changes, update the snapshot
  useEffect(() => {
    if (replayIndex !== null && replayMode) {
      setReplaySnapshot(history[replayIndex] ?? null);
    }
  }, [replayIndex, replayMode, history]);

  // Sync with backend nodes — runs immediately on mount, then every 3s
  // Exposed as ref so addNode/removeNode can trigger immediate re-sync
  const syncNodesRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    let mounted = true;
    async function syncNodes() {
      try {
        const backendNodes = await getNodes();
        if (!mounted) return;
        
        setNodes((prev) => {
          if (prev.length === backendNodes.length) return prev;
          
          const newNodes = [...prev];
          
          // Add missing nodes
          while (newNodes.length < backendNodes.length) {
            const newId = newNodes.length;
            newNodes.push({ 
              id: newId, 
              name: `node${newId}`, 
              state: "HEALTHY", 
              lagMs: 1 + newId * 0.8, 
              cpuBoost: 0 
            });
          }
          
          // Remove extra nodes
          if (newNodes.length > backendNodes.length) {
            newNodes.splice(backendNodes.length);
          }
          
          return newNodes;
        });
      } catch (e) {
        // ignore — backend may be starting up
      }
    }
    syncNodesRef.current = syncNodes;
    syncNodes(); // immediate first call
    const t = setInterval(syncNodes, 3000);
    return () => {
      mounted = false;
      clearInterval(t);
    };
  }, []);

  const dispatchFailure = useCallback((nodeId: number, type: FailureType) => {
    injectFailure(nodeId, type, nodes, setNodes);
  }, [nodes]);

  const dispatchRecover = useCallback((nodeId: number) => {
    recoverNode(nodeId, setNodes);
  }, []);

  const dispatchRecoverAll = useCallback(() => {
    nodes.forEach((n) => {
      if (n.state !== "HEALTHY") recoverNode(n.id, setNodes);
    });
    setPartitions([]);
  }, [nodes]);

  const dispatchPartition = useCallback((from: number, to: number) => {
    const already = partitions.some(
      (p) => (p.from === from && p.to === to) || (p.from === to && p.to === from)
    );
    if (already) return;
    const p = createPartition(from, to);
    setPartitions((prev) => [...prev, p]);
  }, [partitions]);

  const dispatchHealPartition = useCallback((from: number, to: number) => {
    healPartition(from, to);
    setPartitions((prev) =>
      prev.filter(
        (p) => !((p.from === from && p.to === to) || (p.from === to && p.to === from))
      )
    );
  }, []);

  const isPartitioned = useCallback((a: number, b: number) => {
    return partitions.some(
      (p) => (p.from === a && p.to === b) || (p.from === b && p.to === a)
    );
  }, [partitions]);

  const addNode = useCallback(async () => {
    if (nodes.length >= 6) return;
    const newId = nodes.length;
    const addr = `node${newId}:700${newId + 1}`;
    
    // Optimistically add to UI immediately
    setNodes((prev) => [
      ...prev,
      {
        id: newId,
        name: `node${newId}`,
        state: "HEALTHY",
        lagMs: 1 + newId * 0.8,
        cpuBoost: 0,
      }
    ]);

    // Call backend
    await fetch("/api/add-node", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: addr }),
    }).catch(console.error);

    // Re-sync with backend after 500ms to confirm
    setTimeout(() => syncNodesRef.current?.(), 500);
  }, [nodes.length]);

  const removeNode = useCallback(async () => {
    if (nodes.length <= 3) return;
    const targetId = nodes.length - 1;
    const addr = `node${targetId}:700${targetId + 1}`;
    
    // Optimistically remove from UI
    setNodes((prev) => prev.slice(0, -1));
    setPartitions((prev) => prev.filter((p) => p.from !== targetId && p.to !== targetId));

    // Call backend
    await fetch("/api/remove-node", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: addr }),
    }).catch(console.error);

    // Re-sync with backend after 500ms to confirm
    setTimeout(() => syncNodesRef.current?.(), 500);
  }, [nodes.length]);

  const scaleKeys = useCallback(async (delta: number) => {
    await fetch("/api/scale-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ delta }),
    }).catch(console.error);
  }, []);

  // Expose: when replaying, nodes/partitions come from replaySnapshot
  const effectiveNodes = (replayMode && replaySnapshot) ? replaySnapshot.nodes : nodes;
  const effectivePartitions = (replayMode && replaySnapshot) ? replaySnapshot.partitions : partitions;

  const value: ClusterContextValue = {
    nodes: effectiveNodes,
    partitions: effectivePartitions,
    dispatchFailure,
    dispatchRecover,
    dispatchPartition,
    dispatchHealPartition,
    dispatchRecoverAll,
    addNode,
    removeNode,
    scaleKeys,
    isPartitioned,
    history,
    replayMode,
    replayIndex,
    startReplay,
    stopReplay,
    stepReplay,
    recordSnapshot,
  };

  return (
    <ClusterContext.Provider value={value}>
      {children}
    </ClusterContext.Provider>
  );
}
