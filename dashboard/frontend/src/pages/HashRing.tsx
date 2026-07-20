import { useState, useEffect, useRef, useCallback } from "react";
import SectionHeader from "../components/SectionHeader";
import Legend from "../components/hashring/Legend";
import HashRingCanvas from "../components/hashring/HashRingCanvas";
import Stats from "../components/hashring/Stats";
import { generateKeys } from "../utils/hashRing";
import { getRing } from "../api/ring";
import { createRingSocket } from "../api/websocket";
import type { RingNode, RingKey, RingSnapshot } from "../types/hashRing";
import { useClusterStore } from "../store/clusterStore";
import LiveBadge from "../components/LiveBadge";
import { useOperations } from "../store/operationsStore";

// ---------------------------------------------------------------------------
// Mock data — used when the backend is not reachable
// ---------------------------------------------------------------------------

const MOCK_NODES: RingNode[] = [
  { id: 1, angle: -90 },
  { id: 2, angle: 30 },
  { id: 3, angle: 150 },
];

const MOCK_KEYS: RingKey[] = generateKeys(100);


// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function HashRing() {
  const [nodes, setNodes] = useState<RingNode[]>(MOCK_NODES);
  const [keys, setKeys]   = useState<RingKey[]>(MOCK_KEYS);
  const [live, setLive]   = useState(false);
  const [rf, setRf]       = useState<number | undefined>(undefined);
  const [vnodes, setVnodes] = useState<number | undefined>(undefined);
  const wsRef = useRef<WebSocket | null>(null);

  // Apply a ring snapshot from the API
  const applySnapshot = useCallback((snap: RingSnapshot) => {
    if (snap.nodes?.length) setNodes(snap.nodes);
    if (snap.keys?.length)  setKeys(snap.keys);
    if (snap.replication_factor !== undefined) setRf(snap.replication_factor);
    if (snap.virtual_nodes !== undefined) setVnodes(snap.virtual_nodes);
    setLive(true);
  }, []);

  useEffect(() => {
    // 1 — Initial REST fetch
    getRing()
      .then(applySnapshot)
      .catch(() => {
        // Backend not running — keep mock data, no error shown
        setLive(false);
      });

    // 2 — WebSocket for zero-latency push updates
    const ws = createRingSocket((msg: unknown) => {
      const m = msg as { event?: string; data?: RingSnapshot };
      if (m?.event === "ring_update" && m.data) {
        applySnapshot(m.data);
      }
    });
    ws.addEventListener("error", () => setLive(false));
    wsRef.current = ws;

    return () => ws.close();
  }, [applySnapshot]);

  // ---------------------------------------------------------------------------
  // Controls — only active in mock mode; live ring is managed by backend
  // ---------------------------------------------------------------------------

  // When clusterStore node count changes (e.g. Dashboard adds a node),
  // rebuild mock nodes so the ring stays in sync
  const storeNodeCount = useClusterStore(s => s.nodeInfos.length);
  useEffect(() => {
    if (!live && storeNodeCount > 0 && storeNodeCount !== nodes.length) {
      const count = Math.max(3, Math.min(6, storeNodeCount));
      setNodes(
        Array.from({ length: count }, (_, i) => ({
          id: i + 1,
          angle: -90 + (360 / count) * i,
        }))
      );
    }
  }, [storeNodeCount, live, nodes.length]);

  // Controls live on the Dashboard page

  // ── React to add-node / remove-node background ops ─────────────────────
  const allOps = useOperations();
  const nodeOp = allOps.find(
    o => (o.id.startsWith("add-node-") || o.id.startsWith("remove-node-")) && o.status === "running"
  );
  const isRingChanging = !!nodeOp;

  // When a node op is running, poll backend ring aggressively (every 800ms)
  useEffect(() => {
    if (!isRingChanging) return;
    const t = setInterval(() => {
      getRing().then(applySnapshot).catch(() => {});
    }, 800);
    return () => clearInterval(t);
  }, [isRingChanging, applySnapshot]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-8">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <SectionHeader
          title="Consistent Hash Ring"
          subtitle="Key distribution visualization — add/remove nodes from the Dashboard"
        />

      <div className="mt-1 flex shrink-0 items-center gap-3">
          <LiveBadge refreshLabel="5 sec" />
          {isRingChanging && (
            <span className="flex items-center gap-2 rounded-full border border-yellow-700 bg-yellow-950/50 px-4 py-2 text-sm font-bold tracking-widest uppercase text-yellow-400 animate-pulse">
              <span className="h-2.5 w-2.5 rounded-full bg-yellow-400" style={{ animation: "livePulse 1s ease-in-out infinite" }} />
              {nodeOp?.name ?? "Changing"}… {nodeOp ? `${nodeOp.progress}%` : ""}
            </span>
          )}
          {!isRingChanging && (
            <span
              className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold tracking-widest uppercase ${
                live
                  ? "border-green-700 bg-green-950/80 text-green-400 shadow-[0_0_12px_rgba(74,222,128,.15)]"
                  : "border-zinc-700 bg-zinc-900 text-zinc-500"
              }`}
            >
              {live ? (
                <span
                  className="h-2.5 w-2.5 rounded-full bg-green-400"
                  style={{ animation: "livePulse 2s ease-in-out infinite" }}
                />
              ) : (
                <span className="h-2.5 w-2.5 rounded-full bg-zinc-600" />
              )}
              {live ? "Connected" : "Offline"}
            </span>
          )}
        </div>
      </div>

      <Legend nodes={nodes} />

      <HashRingCanvas nodes={nodes} keys={keys} />

      <Stats nodes={nodes} keys={keys} replicationFactor={rf} virtualNodes={vnodes} />

    </div>
  );
}