/**
 * Storage — FLAGSHIP PAGE ⭐⭐⭐⭐⭐
 *
 * Teaches how an LSM-tree works through interactive animated visualization:
 * - Node selector tabs
 * - 7-stat summary strip (all real backend values)
 * - Animated LSM Tree pipeline (WAL → MemTable → Flush → L0–L3)
 *   with real Flush MemTable and Compact Now buttons wired to backend
 * - Live Write Feed (terminal-style, auto-driven by writes/sec)
 * - Storage Events timeline (derived from backend operations)
 * - Bloom Filter Status card (simplified: Enabled, Hit Rate, FP Rate)
 * - SSTable Inspector Drawer (click any SSTable block)
 */
import { useState, useEffect, useRef, useCallback } from "react";
import SectionHeader from "../components/SectionHeader";
import { SSTableDrawer } from "../components/storage/SSTableDrawer";
import type { SSTableMeta } from "../components/storage/SSTableDrawer";
import LSMTreeDiagram from "../components/storage/LSMTreeDiagram";
import LiveWriteFeed from "../components/storage/LiveWriteFeed";
import type { NodeStorage } from "../types/storage";
import { useCluster } from "../context/ClusterContext";
import { useClusterStore } from "../store/clusterStore";
import { triggerRefresh } from "../store/syncEngine";
import LiveBadge from "../components/LiveBadge";
import { useLoadRunning } from "../store/operationsStore";
import { startFlush, startCompact } from "../services/backgroundOps";
import { formatNodeName, formatMb } from "../utils/nodeFormat";

// ── Colors ────────────────────────────────────────────────────────────────────
const NODE_COLORS: Record<number, { color: string; hex: string }> = {
  0: { color: "bg-blue-400",   hex: "#60a5fa" },
  1: { color: "bg-green-400",  hex: "#4ade80" },
  2: { color: "bg-yellow-400", hex: "#facc15" },
  3: { color: "bg-purple-400", hex: "#c084fc" },
  4: { color: "bg-pink-400",   hex: "#f472b6" },
  5: { color: "bg-cyan-400",   hex: "#2dd4bf" },
};

// ── Fallback data ─────────────────────────────────────────────────────────────
function makeFallbackNode(id: number): NodeStorage {
  const c = NODE_COLORS[id] ?? { color: "bg-zinc-400", hex: "#a1a1aa" };
  return {
    id, name: `node${id}`, port: 7001 + id, color: c.color, hex: c.hex,
    key_count: null,
    memtable: { size: null, entries: null, maxMb: 64 },
    wal: { size: null, segments: null },
    sstables: [
      { level: 0, count: 0, sizeMb: 0 },
      { level: 1, count: 0, sizeMb: 0 },
      { level: 2, count: 0, sizeMb: 0 },
    ],
    compactionQueue: null,
    compaction_runs: null,
    bloom_hit_rate: null,
    write_amplification: null,
    read_amplification: null,
    totalDisk: null,
  };
}

// ── Stat pill ─────────────────────────────────────────────────────────────────
function StatPill({
  icon, label, value, alert, unavailable, sub,
}: {
  icon: string; label: string; value: string | null;
  alert?: boolean; unavailable?: boolean; sub?: string;
}) {
  const display = value ?? "—";
  return (
    <div className={`rounded-xl p-3 flex flex-col gap-0.5 ${
      unavailable ? "bg-zinc-900/40 border border-zinc-800"
      : alert ? "bg-yellow-950/20 border border-yellow-800"
      : "bg-zinc-900 border border-zinc-800"
    }`}>
      <p className="text-[10px] text-zinc-500 uppercase tracking-wider">{icon} {label}</p>
      <p className={`text-base font-bold font-mono leading-tight ${
        unavailable ? "text-zinc-600" : alert ? "text-yellow-400" : "text-white"
      }`}>{display}</p>
      {sub && <p className="text-[9px] text-zinc-700">{sub}</p>}
    </div>
  );
}

// ── Storage Event ─────────────────────────────────────────────────────────────
interface StorageEvent {
  id: number;
  ts: string;
  type: "flush_start" | "flush_done" | "compact_start" | "compact_done" | "snapshot";
  label: string;
  node: string;
}

const EVENT_COLORS: Record<StorageEvent["type"], string> = {
  flush_start:   "text-blue-400",
  flush_done:    "text-green-400",
  compact_start: "text-yellow-400",
  compact_done:  "text-purple-400",
  snapshot:      "text-cyan-400",
};

const EVENT_ICONS: Record<StorageEvent["type"], string> = {
  flush_start:   "⚡",
  flush_done:    "✓",
  compact_start: "🗜",
  compact_done:  "✓",
  snapshot:      "📸",
};

let _evId = 0;
function makeEvent(type: StorageEvent["type"], label: string, node: string): StorageEvent {
  const d = new Date();
  const ts = `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}:${String(d.getSeconds()).padStart(2,"0")}`;
  return { id: _evId++, ts, type, label, node };
}

// ── Bloom Filter Status Card ──────────────────────────────────────────────────
function BloomStatusCard({ hitRate, nodeHex }: { hitRate: number | null; nodeHex: string }) {
  const hitDisplay = hitRate != null ? `${hitRate.toFixed(1)}%` : "—";
  // FP rate is inverse estimate: a 96% hit rate implies low FP
  const fpEstimate = hitRate != null ? `< ${Math.max(0.1, (100 - hitRate) * 0.05).toFixed(1)}%` : "—";

  return (
    <div className="rounded-2xl border border-zinc-700 bg-zinc-900/60 p-6 space-y-4">
      <div className="flex items-center gap-3">
        <div className="h-7 w-1.5 rounded-full bg-green-400" />
        <div>
          <h3 className="text-sm font-bold text-white">Bloom Filter</h3>
          <p className="text-xs text-zinc-500">Probabilistic key membership test · avoids disk reads for missing keys</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
          <p className="text-[10px] text-zinc-600 uppercase tracking-wider">Enabled</p>
          <p className="text-base font-bold text-green-400 mt-0.5">✅ Yes</p>
          <p className="text-[9px] text-zinc-700 mt-1">All SSTables</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
          <p className="text-[10px] text-zinc-600 uppercase tracking-wider">Hit Rate</p>
          <p className="text-base font-bold font-mono mt-0.5" style={{ color: hitRate != null ? nodeHex : "#52525b" }}>
            {hitDisplay}
          </p>
          <p className="text-[9px] text-zinc-700 mt-1">GET lookups avoided</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
          <p className="text-[10px] text-zinc-600 uppercase tracking-wider">False Positive</p>
          <p className="text-base font-bold font-mono text-zinc-300 mt-0.5">
            {fpEstimate}
          </p>
          <p className="text-[9px] text-zinc-700 mt-1">Rate estimate</p>
        </div>
      </div>

      <p className="text-[10px] text-zinc-600 leading-relaxed border-t border-zinc-800 pt-3">
        The Bloom filter is checked before any SSTable disk read.
        If the filter says <span className="text-zinc-400">"definitely not present"</span>,
        the disk read is skipped entirely — eliminating the most expensive operation in an LSM tree.
      </p>
    </div>
  );
}

// ── Storage Events Panel ──────────────────────────────────────────────────────
function StorageEventsPanel({ events }: { events: StorageEvent[] }) {
  return (
    <div className="rounded-2xl border border-zinc-700 bg-zinc-900/60 p-6 space-y-3">
      <div className="flex items-center gap-3">
        <div className="h-7 w-1.5 rounded-full bg-zinc-500" />
        <div>
          <h3 className="text-sm font-bold text-white">Storage Events</h3>
          <p className="text-xs text-zinc-500">Flush · Compaction · Snapshot lifecycle</p>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-950 overflow-hidden">
        <div className="font-mono text-[10px] divide-y divide-zinc-900 max-h-40 overflow-y-auto">
          {events.length === 0 ? (
            <div className="px-3 py-4 text-zinc-700 text-center">No events yet — run operations from Dashboard</div>
          ) : (
            events.map((ev) => (
              <div key={ev.id} className="flex items-center gap-3 px-3 py-1.5 hover:bg-zinc-900/40 transition-colors">
                <span className="text-zinc-600 shrink-0 w-16">{ev.ts}</span>
                <span className={`shrink-0 w-4 ${EVENT_COLORS[ev.type]}`}>{EVENT_ICONS[ev.type]}</span>
                <span className={`${EVENT_COLORS[ev.type]} shrink-0`}>{ev.label}</span>
                <span className="text-zinc-600 ml-auto shrink-0 text-[9px]">{ev.node}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function Storage() {
  const { nodes: runtimeNodes } = useCluster();
  const [drawerTable, setDrawerTable] = useState<SSTableMeta | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState(0);
  const [storageEvents, setStorageEvents] = useState<StorageEvent[]>([]);

  // Global load op state — reacts even when Dashboard starts the load
  const loadRunning = useLoadRunning();

  // Read storage data from global store (persists across navigation)
  const storeStorageData = useClusterStore(s => s.storageData);
  const [nodes, setNodes] = useState<NodeStorage[]>([]);

  // Track writes/sec from WS for passing to children
  const [writesPerSec, setWritesPerSec] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (storeStorageData.length > 0) setNodes(storeStorageData);
  }, [storeStorageData]);

  // Build node list — merge backend data with runtime node count
  const allNodes: NodeStorage[] = runtimeNodes.map((rn) => {
    const backend = nodes.find((n) => n.id === rn.id);
    return backend ?? makeFallbackNode(rn.id);
  });

  const safeId = Math.min(selectedNodeId, allNodes.length - 1);
  const node = allNodes[safeId] ?? makeFallbackNode(safeId);
  const runtime = runtimeNodes.find((r) => r.id === node.id);
  const isDown = runtime?.state === "UNREACHABLE";

  const totalSSTables = node.sstables.reduce((a, l) => a + l.count, 0);

  const memPct = node.memtable.size != null && node.memtable.maxMb
    ? Math.round((node.memtable.size / node.memtable.maxMb) * 100)
    : null;
  const memPctDisplay = memPct === null ? null
    : memPct === 0 && node.memtable.entries === 0 ? "✓ Empty"
    : `${memPct}%`;
  const isMemAlert = memPct != null && memPct > 80;

  // ── WS metrics for writes/sec (drives LiveWriteFeed & WAL status) ─────────
  useEffect(() => {
    function connect() {
      if (wsRef.current && wsRef.current.readyState < 2) return;
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${window.location.host}/ws/metrics`);
      wsRef.current = ws;
      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          let total = 0;
          if (Array.isArray(data)) {
            total = data.reduce((s: number, n: any) => s + (n.writes_per_sec ?? 0), 0);
          } else if (data.nodes) {
            total = Object.values(data.nodes as Record<string, any>).reduce(
              (s: number, n: any) => s + (n.writes_per_sec ?? 0), 0
            ) as number;
          }
          setWritesPerSec(Math.round(total));
        } catch { /* ignore */ }
      };
      ws.onerror = () => ws.close();
      ws.onclose = () => {
        wsRef.current = null;
        setTimeout(connect, 4000);
      };
    }
    connect();
    return () => { if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close(); } };
  }, []);

  // ── Event handlers from LSMTreeDiagram callbacks ──────────────────────────
  const handleFlushComplete = useCallback(async () => {
    await startFlush();
    setStorageEvents(prev => [
      makeEvent("flush_start", "Flush Started", node.name),
      makeEvent("flush_done", "Flush Finished", node.name),
      ...prev,
    ].slice(0, 20));
    triggerRefresh();
  }, [node.name]);

  const handleCompactComplete = useCallback(async () => {
    await startCompact();
    setStorageEvents(prev => [
      makeEvent("compact_start", "Compaction Started", node.name),
      makeEvent("compact_done", "Compaction Finished", node.name),
      ...prev,
    ].slice(0, 20));
    triggerRefresh();
  }, [node.name]);

  // Also watch snapshots in global store for storage events
  const snapshots = useClusterStore(s => s.snapshots);
  const prevSnapCount = useRef(snapshots.length);
  useEffect(() => {
    if (snapshots.length > prevSnapCount.current) {
      const newest = snapshots[0];
      setStorageEvents(prev => [
        makeEvent("snapshot", `Snapshot Created: ${newest?.name ?? ""}`, "all nodes"),
        ...prev,
      ].slice(0, 20));
    }
    prevSnapCount.current = snapshots.length;
  }, [snapshots]);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <SectionHeader
          title="Storage Engine"
          subtitle="LSM-Tree internals · WAL · MemTable · SSTables · Bloom Filters"
        />
        <LiveBadge refreshLabel="5 sec" />
      </div>

      {/* Node selector tabs */}
      <div className="flex flex-wrap gap-2">
        {allNodes.map((n) => {
          const rt = runtimeNodes.find((r) => r.id === n.id);
          const isNodeDown = rt?.state === "UNREACHABLE";
          const isSelected = n.id === safeId;
          return (
            <button
              key={n.id}
              onClick={() => setSelectedNodeId(n.id)}
              className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-bold transition-all duration-200 ${
                isSelected
                  ? "border-transparent text-white shadow-lg scale-105"
                  : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-600"
              }`}
              style={isSelected ? { backgroundColor: n.hex + "22", borderColor: n.hex + "66" } : {}}
            >
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{
                  backgroundColor: isNodeDown ? "#52525b" : n.hex,
                  animation: isNodeDown ? "none" : "pulse 2s infinite",
                }}
              />
              {/* Tab label — friendly name, full hostname in tooltip */}
              <span title={`${n.name} · ${n.id !== undefined ? 'port ' + (7001 + n.id) : ''}`}>
                {formatNodeName(n.name)}
              </span>
              {isNodeDown && <span className="text-[10px] text-red-400 font-bold">DEAD</span>}
            </button>
          );
        })}
      </div>

      {/* Down overlay */}
      {isDown && (
        <div className="rounded-xl border border-red-800 bg-red-950/30 px-5 py-4 flex items-center gap-3">
          <span className="text-red-400 text-2xl">💀</span>
          <div>
            <p className="text-red-300 font-bold">Storage Unavailable — node{node.id} is UNREACHABLE</p>
            <p className="text-red-400/60 text-xs">MemTable halted · WAL unresponsive · SSTables inaccessible</p>
          </div>
        </div>
      )}

      {/* 7-stat summary strip */}
      <div className="grid grid-cols-7 gap-3">
        <StatPill icon="📝" label="MemTable"
          value={memtableEntries(node)}
          alert={isMemAlert}
        />
        <StatPill icon="🧠" label="Mem Usage"
          value={memPctDisplay}
          alert={isMemAlert}
          sub={node.memtable.size != null ? formatMb(node.memtable.size) : undefined}
        />
        <StatPill icon="✍" label="WAL Est."
          value={node.wal.size != null ? formatMb(node.wal.size) : null}
          unavailable={node.wal.size === null}
          sub={node.wal.size != null ? "~60% of disk" : "not tracked"}
        />
        <StatPill icon="💿" label="Disk (total)"
          value={node.totalDisk != null ? formatMb(node.totalDisk) : null}
          sub="WAL + SSTables"
        />
        <StatPill icon="📄" label="SSTables" value={String(totalSSTables)} />
        <StatPill icon="🔄" label="Compactions"
          value={node.compaction_runs != null ? String(node.compaction_runs) : null}
          unavailable={node.compaction_runs === null}
          sub="total runs"
        />
        <StatPill icon="🌸" label="Bloom Hit"
          value={node.bloom_hit_rate != null ? `${node.bloom_hit_rate.toFixed(1)}%` : null}
          unavailable={node.bloom_hit_rate === null}
        />
      </div>

      {/* ═══ CENTERPIECE: LSM Tree Pipeline ═══ */}
      <div className="rounded-2xl border border-zinc-700 bg-zinc-900/60 p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="h-8 w-1.5 rounded-full" style={{ backgroundColor: node.hex }} />
          <div>
            <h2 className="text-base font-bold text-white">LSM-Tree — {formatNodeName(node.name)}</h2>
            <p className="text-xs text-zinc-500">
              Write path: Client → WAL → MemTable → Flush → L0 → Compact → L1/L2/L3
            </p>
          </div>
          <div className="ml-auto text-[10px] text-zinc-600">
            {node.memtable.entries != null ? `${node.memtable.entries.toLocaleString()} entries` : "entries unknown"} · {totalSSTables} SSTables
          </div>
        </div>

        <LSMTreeDiagram
          memtableUsedMb={node.memtable.size}
          memtableMaxMb={node.memtable.maxMb}
          memtableEntries={node.memtable.entries}
          walSizeMb={node.wal.size}
          walSegments={node.wal.segments}
          writesPerSec={writesPerSec}
          sstables={node.sstables}
          nodeHex={node.hex}
          compactionQueue={node.compactionQueue}
          compactionRuns={node.compaction_runs}
          onSSTableClick={setDrawerTable}
          onFlushComplete={handleFlushComplete}
          onCompactComplete={handleCompactComplete}
          nodeId={node.id}
        />
      </div>

      {/* ═══ Live Write Feed ═══ */}
      <div className="rounded-2xl border border-zinc-700 bg-zinc-900/60 p-6">
        <LiveWriteFeed
          memtableUsedMb={node.memtable.size ?? 0}
          memtableMaxMb={node.memtable.maxMb}
          nodeHex={node.hex}
          nodeId={node.id}
          writesPerSec={writesPerSec}
          loadRunning={loadRunning}
        />
      </div>

      {/* ═══ Bottom row: Storage Events + Bloom Filter ═══ */}
      <div className="grid grid-cols-2 gap-6">
        <StorageEventsPanel events={storageEvents} />
        <BloomStatusCard hitRate={node.bloom_hit_rate} nodeHex={node.hex} />
      </div>

      {/* SSTable Inspector Drawer */}
      <SSTableDrawer table={drawerTable} onClose={() => setDrawerTable(null)} />
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function memtableEntries(node: NodeStorage): string | null {
  if (node.memtable.entries === null) return null;
  if (node.memtable.entries === 0) return "✓ Empty";
  return node.memtable.entries.toLocaleString();
}