/**
 * Dashboard — Control Center
 *
 * Left:  Cluster overview (stat cards, node grid, recent events)
 * Right: All controls (load generator, cluster ops, key operations)
 *
 * This is the page you start every interview demo with.
 */
import { useState, useEffect, useRef } from "react";
import { useCluster } from "../context/ClusterContext";
import { eventBus } from "../services/eventBus";
import type { ClusterEvent } from "../types/failure";
import { type NodeInfo } from "../api/cluster";
import { setKey, getKey, deleteKey } from "../api/keys";
import {
  Server, Database, ShieldCheck, Timer,
  Plus, Minus, Camera,
  RotateCcw, HardDrive,
} from "lucide-react";
import { useClusterStore } from "../store/clusterStore";
import { triggerRefresh } from "../store/syncEngine";
import LiveBadge from "../components/LiveBadge";
import {
  startLoadGeneration,
  stopLoadGeneration,
  startFlush,
  startCompact,
  startSnapshot,
  startAddNode,
  startRemoveNode,
} from "../services/backgroundOps";
import { useOperations } from "../store/operationsStore";

// ─── State → visual config ───────────────────────────────────────────────────
const STATE_CARD: Record<string, {
  label: string; textCls: string; borderCls: string; bgCls: string; dot: string;
}> = {
  HEALTHY:     { label: "HEALTHY",     textCls: "text-green-400",  borderCls: "border-zinc-800",   bgCls: "bg-zinc-900/50",    dot: "#4ade80" },
  SUSPECT:     { label: "SUSPECT",     textCls: "text-yellow-400", borderCls: "border-yellow-800", bgCls: "bg-yellow-950/20",  dot: "#facc15" },
  UNREACHABLE: { label: "DEAD",        textCls: "text-red-400",    borderCls: "border-red-900",    bgCls: "bg-red-950/30",     dot: "#f87171" },
  RECOVERING:  { label: "RECOVERING",  textCls: "text-blue-400",   borderCls: "border-blue-800",   bgCls: "bg-blue-950/20",    dot: "#60a5fa" },
  REBALANCING: { label: "REBALANCING", textCls: "text-purple-400", borderCls: "border-purple-800", bgCls: "bg-purple-950/20",  dot: "#c084fc" },
};

// ─── Types ────────────────────────────────────────────────────────────────────
interface RecentEvent { time: string; msg: string; level: "ok" | "warn" | "err" }

// LoadStatus type kept only for type narrowing if needed
// (actual load state is in operationsStore)

const LOAD_PRESETS = {
  Light:  { writes: 25,  reads: 25,  deletes: 10, parallelism: 3 },
  Medium: { writes: 100, reads: 100, deletes: 40, parallelism: 5 },
  Heavy:  { writes: 300, reads: 300, deletes: 100, parallelism: 10 },
} as const;
type LoadPreset = keyof typeof LOAD_PRESETS | "Custom";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtTime(d: Date) {
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}:${String(d.getSeconds()).padStart(2,"0")}`;
}
function fmtUptime(s: number) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${h}h ${m}m ${sec}s`;
}

// ─── Stat card ────────────────────────────────────────────────────────────────
function StatCard({ title, value, icon: Icon, sub, accent }: {
  title: string; value: string | number; icon: React.ElementType;
  sub?: string; accent?: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 flex items-start gap-3">
      <div className="rounded-lg p-2" style={{ backgroundColor: (accent ?? "#60a5fa") + "15" }}>
        <Icon size={16} style={{ color: accent ?? "#60a5fa" }} />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] text-zinc-500 uppercase tracking-wider">{title}</p>
        <p className="text-lg font-bold font-mono text-white leading-tight">{value}</p>
        {sub && <p className="text-[10px] text-zinc-600 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ─── Section label ────────────────────────────────────────────────────────────
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">{children}</p>
  );
}

// ─── Control button ───────────────────────────────────────────────────────────
function CtrlBtn({ onClick, disabled, variant = "default", children }: {
  onClick?: () => void; disabled?: boolean;
  variant?: "default" | "green" | "red" | "blue" | "purple";
  children: React.ReactNode;
}) {
  const variants = {
    default: "border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white",
    green:   "border-green-800 bg-green-950/40 text-green-400 hover:bg-green-900/60",
    red:     "border-red-800 bg-red-950/30 text-red-400 hover:bg-red-900/50",
    blue:    "border-blue-700 bg-blue-950/40 text-blue-400 hover:bg-blue-900/60",
    purple:  "border-purple-800 bg-purple-950/30 text-purple-400 hover:bg-purple-900/50",
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 ${variants[variant]}`}
    >
      {children}
    </button>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { nodes: runtimeNodes, addNode, removeNode } = useCluster();

  // Cluster data
  // clusterInfo is read for displayKeyCount fallback; setter unused (data comes from store)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [clusterInfo, _setClusterInfo_unused] = useState({ key_count: 0, replication_factor: 2, uptime_seconds: 0 });
  const [nodeInfos, setNodeInfos] = useState<NodeInfo[]>([]);
  const [uptime, setUptime] = useState(0);
  const [events, setEvents] = useState<RecentEvent[]>([
    { time: "—", msg: "Cluster started", level: "ok" },
    { time: "—", msg: "Replication in sync", level: "ok" },
  ]);

  // ── Global ops store — load state lives here, not locally ─────────────────
  const allOps = useOperations();
  const loadOp = allOps.find(o => o.id.startsWith("load-") && o.status === "running")
               ?? [...allOps].sort((a, b) => b.startedAt - a.startedAt).find(o => o.id.startsWith("load-"));
  const isLoadRunning = loadOp?.status === "running";
  const loadPct       = loadOp?.progress ?? 0;

  // Key operations
  const [keyInput, setKeyInput]     = useState("");
  const [valueInput, setValueInput] = useState("");
  const [keyResult, setKeyResult]   = useState<string | null>(null);
  const [keyError, setKeyError]     = useState<string | null>(null);
  const [keyLoading, setKeyLoading] = useState(false);

  // Load generator UI state
  const [preset, setPreset]   = useState<LoadPreset>("Medium");
  const [custom, setCustom]   = useState({ writes: 50, reads: 50, deletes: 10, parallelism: 5 });

  // Flash IDs for node state changes
  const prevStatesRef = useRef<Record<number, string>>({});
  const [flashIds, setFlashIds] = useState<Set<number>>(new Set());

  // ── Pull stat card data from global clusterStore (persists across navigation) ──
  const storeClusterInfo = useClusterStore(s => s.clusterInfo);
  const storeNodeInfos   = useClusterStore(s => s.nodeInfos);

  // ── Fetch cluster + node data — ALSO update local display state ──────────────
  // We keep a local uptime ticker separate from the store (increments every 1s)
  useEffect(() => {
    // Sync local uptime from store when it arrives
    if (storeClusterInfo) {
      setUptime(storeClusterInfo.uptime_seconds);
    }
  }, [storeClusterInfo?.uptime_seconds]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Also keep nodeInfos in sync from store ─────────────────────────────────
  useEffect(() => {
    if (storeNodeInfos.length > 0) setNodeInfos(storeNodeInfos);
  }, [storeNodeInfos]);

  // ── Local uptime ticker ────────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setUptime(s => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // ── Node state transitions → flash ─────────────────────────────────────────
  useEffect(() => {
    const prev = prevStatesRef.current;
    const flashing = new Set<number>();
    runtimeNodes.forEach(n => {
      if (prev[n.id] !== undefined && prev[n.id] !== n.state) flashing.add(n.id);
      prev[n.id] = n.state;
    });
    if (flashing.size > 0) {
      setFlashIds(flashing);
      setTimeout(() => setFlashIds(new Set()), 1500);
    }
  }, [runtimeNodes]);

  // ── Event bus ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (ev: ClusterEvent) => {
      const level: RecentEvent["level"] =
        ev.type === "FAILURE_INJECTED" || ev.nodeState === "UNREACHABLE" ? "err"
        : ev.nodeState === "SUSPECT" || ev.nodeState === "REBALANCING" ? "warn"
        : "ok";
      setEvents(prev => [{ time: fmtTime(new Date()), msg: ev.message, level }, ...prev.slice(0, 11)]);
    };
    eventBus.subscribe(handler);
    return () => eventBus.unsubscribe(handler);
  }, []);

  // ── Load generator (delegates entirely to backgroundOps + operationsStore) ─
  async function handleGenerateLoad() {
    const params = preset === "Custom" ? custom : LOAD_PRESETS[preset as keyof typeof LOAD_PRESETS];
    pushEvent(`Load started — ${params.writes}W + ${params.reads}R + ${params.deletes}D`, "ok");
    await startLoadGeneration(params);
    triggerRefresh();
  }

  async function handleStopLoad() {
    await stopLoadGeneration();
    pushEvent("Load generation stopped", "warn");
  }

  function pushEvent(msg: string, level: RecentEvent["level"] = "ok") {
    setEvents(prev => [{ time: fmtTime(new Date()), msg, level }, ...prev.slice(0, 11)]);
  }


  // ── Cluster controls ──────────────────────────────────────────────────────
  async function handleAddNode() {
    await startAddNode(addNode);
    pushEvent(`Node added: node${runtimeNodes.length}`, "ok");
  }
  async function handleRemoveNode() {
    await startRemoveNode(removeNode);
    pushEvent(`Node removed: node${runtimeNodes.length - 1}`, "warn");
  }
  async function handleSnapshot() {
    const name = `snap-${Date.now()}`;
    await startSnapshot(name);
    pushEvent(`Snapshot created: ${name}`, "ok");
  }
  async function handleFlush() {
    await startFlush();
    pushEvent("MemTable flush triggered", "ok");
  }
  async function handleCompact() {
    await startCompact();
    pushEvent("Compaction triggered", "ok");
  }

  // ── Key operations ────────────────────────────────────────────────────────
  async function handleSetKey() {
    if (!keyInput.trim() || !valueInput.trim()) return;
    setKeyLoading(true); setKeyError(null); setKeyResult(null);
    try {
      const res = await setKey(keyInput.trim(), valueInput.trim());
      setKeyResult(`✅ Stored: "${res.key}" = "${res.value}"`);
      pushEvent(`SET ${res.key}`, "ok");
      setKeyInput(""); setValueInput("");
      triggerRefresh();
    } catch (e: any) {
      setKeyError(`❌ ${e.message}`);
    } finally { setKeyLoading(false); }
  }
  async function handleGetKey() {
    if (!keyInput.trim()) return;
    setKeyLoading(true); setKeyError(null); setKeyResult(null);
    try {
      const res = await getKey(keyInput.trim());
      setKeyResult(`📖 "${res.key}" = "${res.value}"`);
      pushEvent(`GET ${res.key} → ${res.value}`, "ok");
    } catch (e: any) {
      setKeyError(`❌ ${e.message}`);
    } finally { setKeyLoading(false); }
  }
  async function handleDeleteKey() {
    if (!keyInput.trim()) return;
    setKeyLoading(true); setKeyError(null); setKeyResult(null);
    try {
      await deleteKey(keyInput.trim());
      setKeyResult(`🗑 Deleted: "${keyInput.trim()}"`);
      pushEvent(`DEL ${keyInput.trim()}`, "warn");
      setKeyInput("");
      triggerRefresh();
    } catch (e: any) {
      setKeyError(`❌ ${e.message}`);
    } finally { setKeyLoading(false); }
  }

  // ── Derived state ─────────────────────────────────────────────────────────
  const healthyCount  = runtimeNodes.filter(n => n.state === "HEALTHY").length;
  const downCount     = runtimeNodes.filter(n => n.state === "UNREACHABLE").length;
  const clusterStatus = downCount > 0 ? "DEGRADED" : healthyCount < runtimeNodes.length ? "SUSPECT" : "HEALTHY";
  const statusColor   = clusterStatus === "HEALTHY" ? "#4ade80" : clusterStatus === "DEGRADED" ? "#f87171" : "#facc15";

  // Read key count from global store (persists across navigation)
  const displayKeyCount = storeClusterInfo?.key_count ?? clusterInfo.key_count;

  return (
    <div className="flex gap-6 h-full">
      {/* ════════════════ LEFT: Main content ═══════════════════════════════ */}
      <div className="flex-1 min-w-0 space-y-6 overflow-auto pb-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">Dashboard</h1>
            <p className="text-xs text-zinc-500 mt-0.5">Distributed Cluster Control Center</p>
          </div>
          <div className="flex items-center gap-3">
            <LiveBadge refreshLabel="Event-driven" />
            <div
              className="rounded-full px-3 py-1 text-xs font-bold border tracking-widest"
              style={{ color: statusColor, borderColor: statusColor + "40", backgroundColor: statusColor + "10" }}
            >
              ● {clusterStatus}
            </div>
          </div>
        </div>

        {/* Load completion banner removed — global BackgroundTasksWidget + ToastContainer handle it */}

        {/* Alert banners */}
        {downCount > 0 && (
          <div className="rounded-xl border border-red-800 bg-red-950/30 px-4 py-3 flex items-center gap-3 animate-pulse">
            <span className="text-red-400 text-xl">💀</span>
            <div>
              <p className="text-red-300 font-bold text-sm">{downCount} node{downCount > 1 ? "s" : ""} UNREACHABLE — cluster degraded</p>
              <p className="text-red-400/60 text-xs">{healthyCount}/{runtimeNodes.length} nodes healthy · Keys redistributing</p>
            </div>
          </div>
        )}
        {runtimeNodes.some(n => n.state === "REBALANCING") && (
          <div className="rounded-xl border border-purple-800 bg-purple-950/20 px-4 py-3 flex items-center gap-3">
            <span className="text-purple-400 text-xl animate-spin" style={{ display: "inline-block" }}>↻</span>
            <p className="text-purple-300 font-bold text-sm">Rebalancing in progress · Hash ring updating</p>
          </div>
        )}

        {/* Stat cards */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          <StatCard title="Cluster Health" value={clusterStatus} icon={ShieldCheck} accent={statusColor} />
          <StatCard title="Nodes" value={`${healthyCount} / ${runtimeNodes.length}`} icon={Server}
            sub={downCount > 0 ? `${downCount} down` : "All healthy"} accent="#60a5fa" />
          <StatCard title="Total Keys" value={displayKeyCount.toLocaleString()} icon={Database} accent="#4ade80" />
          <StatCard title="Uptime" value={fmtUptime(uptime)} icon={Timer} accent="#a78bfa" />
        </div>

        {/* Node grid */}
        <div>
          <SectionLabel>Node Status</SectionLabel>
          <div className={`grid gap-3 ${
            runtimeNodes.length <= 2 ? "grid-cols-2"
            : runtimeNodes.length <= 4 ? "grid-cols-2"
            : "grid-cols-3"
          }`}>
            {runtimeNodes.map(n => {
              const card = STATE_CARD[n.state] ?? STATE_CARD.HEALTHY;
              const isDown = n.state === "UNREACHABLE";
              const isFlashing = flashIds.has(n.id);
              const info = nodeInfos.find(ni => ni.id === n.id);

              return (
                <div
                  key={n.id}
                  className={`rounded-xl border p-4 space-y-3 transition-all duration-500 ${card.borderCls} ${card.bgCls} ${isFlashing ? "scale-[0.97] brightness-150" : ""}`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-sm font-bold ${isDown ? "text-zinc-500 line-through" : "text-white"}`}>
                      node{n.id}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{
                          backgroundColor: card.dot,
                          animation: isDown ? "none" : n.state === "HEALTHY" ? "pulse 2s infinite" : "pulse 0.8s infinite",
                        }}
                      />
                      <span className={`text-[10px] font-bold uppercase tracking-wider ${card.textCls}`}>{card.label}</span>
                    </div>
                  </div>

                  {isDown ? (
                    <div className="flex items-center gap-2 py-1">
                      <span className="text-red-500">💀</span>
                      <span className="text-xs text-red-400 font-bold">NODE UNREACHABLE</span>
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <p className="text-zinc-500 mb-1">Port</p>
                        <p className="font-mono text-zinc-300">{info?.port ?? 7001 + n.id}</p>
                      </div>
                      <div>
                        <p className="text-zinc-500 mb-1">Keys</p>
                        <p className="font-mono text-zinc-300">{info?.key_count ?? "—"}</p>
                      </div>
                      <div>
                        <p className="text-zinc-500 mb-1">Disk</p>
                        <p className="font-mono text-zinc-300">{info ? `${info.disk_mb.toFixed(1)}MB` : "—"}</p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Recent Events */}
        <div>
          <SectionLabel>Recent Events</SectionLabel>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-1.5 max-h-48 overflow-y-auto">
            {events.map((e, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <span className="text-zinc-600 font-mono w-10 shrink-0">{e.time}</span>
                <span className={`mt-0.5 shrink-0 ${e.level === "err" ? "text-red-400" : e.level === "warn" ? "text-yellow-400" : "text-green-400"}`}>●</span>
                <span className={e.level === "err" ? "text-red-300" : e.level === "warn" ? "text-yellow-300" : "text-zinc-400"}>
                  {e.msg}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ════════════════ RIGHT: Controls panel ════════════════════════════ */}
      <div className="w-80 shrink-0 space-y-5 overflow-auto pb-4">

        {/* ── Load Generator ─────────────────────────────────────────────── */}
        <div className="rounded-xl border border-zinc-700 bg-zinc-900/60 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-zinc-200 uppercase tracking-widest">⚡ Generate Load</p>
            {isLoadRunning && (
              <span className="text-[9px] font-bold text-blue-400 bg-blue-950/40 border border-blue-800 rounded-full px-2 py-0.5 animate-pulse">RUNNING</span>
            )}
          </div>
          <p className="text-[10px] text-zinc-600">Fires real GET/SET/DEL through the cluster. For demos only.</p>

          {/* Preset tabs */}
          <div className="flex gap-1">
            {(["Light", "Medium", "Heavy", "Custom"] as LoadPreset[]).map(p => (
              <button
                key={p}
                onClick={() => setPreset(p)}
                className={`flex-1 rounded-lg border py-1.5 text-[10px] font-bold transition-all ${
                  preset === p
                    ? "border-blue-600 bg-blue-950/40 text-blue-400"
                    : "border-zinc-700 bg-zinc-900 text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {p}
              </button>
            ))}
          </div>

          {/* Preset details or custom inputs */}
          {preset !== "Custom" ? (
            <div className="grid grid-cols-3 gap-1 text-[10px] text-zinc-400 font-mono">
              <div className="rounded bg-zinc-800 px-2 py-1.5 text-center">
                <div className="text-zinc-600 mb-0.5">Writes</div>
                <div className="text-white font-bold">{LOAD_PRESETS[preset as keyof typeof LOAD_PRESETS].writes}</div>
              </div>
              <div className="rounded bg-zinc-800 px-2 py-1.5 text-center">
                <div className="text-zinc-600 mb-0.5">Reads</div>
                <div className="text-white font-bold">{LOAD_PRESETS[preset as keyof typeof LOAD_PRESETS].reads}</div>
              </div>
              <div className="rounded bg-zinc-800 px-2 py-1.5 text-center">
                <div className="text-zinc-600 mb-0.5">Deletes</div>
                <div className="text-white font-bold">{LOAD_PRESETS[preset as keyof typeof LOAD_PRESETS].deletes}</div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {(["writes", "reads", "deletes", "parallelism"] as const).map(k => (
                <label key={k} className="flex flex-col gap-1">
                  <span className="text-[9px] text-zinc-500 uppercase tracking-wider">{k}</span>
                  <input
                    type="number" min={1} max={k === "parallelism" ? 20 : 1000}
                    value={custom[k]}
                    onChange={e => setCustom(prev => ({ ...prev, [k]: parseInt(e.target.value) || 1 }))}
                    className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs font-mono text-white"
                  />
                </label>
              ))}
            </div>
          )}

          {/* Buttons */}
          <div className="flex gap-2">
            <button
              onClick={handleGenerateLoad}
              disabled={isLoadRunning}
              className="flex-1 rounded-lg border border-green-700 bg-green-950/30 py-2 text-xs font-bold text-green-400 hover:bg-green-900/40 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ▶ Start
            </button>
            {isLoadRunning && (
              <button
                onClick={handleStopLoad}
                className="rounded-lg border border-red-800 bg-red-950/20 px-3 py-2 text-xs font-bold text-red-400 hover:bg-red-900/40 transition"
              >
                ■ Stop
              </button>
            )}
          </div>

          {/* Progress — reads from global operationsStore */}
          {isLoadRunning && (
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] text-zinc-500">
                <span>Running…</span>
                <span>{loadPct}%</span>
              </div>
              <div className="h-1 rounded-full bg-zinc-800">
                <div className="h-1 rounded-full bg-blue-500 transition-all duration-700" style={{ width: `${loadPct}%` }} />
              </div>
              <p className="text-[9px] text-zinc-600">Progress tracked globally — navigate freely</p>
            </div>
          )}
          {!isLoadRunning && loadOp?.status === "completed" && (
            <div className="rounded-lg border border-green-900/40 bg-green-950/10 px-2 py-1.5 text-[10px] text-zinc-400 font-mono">
              <span className="text-green-400 font-bold">✓ Done · </span>
              {loadOp.result}
            </div>
          )}
        </div>

        {/* ── Cluster Controls ────────────────────────────────────────────── */}
        <div className="rounded-xl border border-zinc-700 bg-zinc-900/60 p-4 space-y-3">
          <p className="text-xs font-bold text-zinc-200 uppercase tracking-widest">🖥 Cluster Controls</p>
          <div className="grid grid-cols-2 gap-2">
            <CtrlBtn onClick={handleAddNode} disabled={runtimeNodes.length >= 6} variant="green">
              <Plus size={12} /> Add Node
            </CtrlBtn>
            <CtrlBtn onClick={handleRemoveNode} disabled={runtimeNodes.length <= 3} variant="red">
              <Minus size={12} /> Remove Node
            </CtrlBtn>
            <CtrlBtn onClick={handleSnapshot} variant="blue">
              <Camera size={12} /> Snapshot
            </CtrlBtn>
            <CtrlBtn onClick={handleFlush} variant="purple">
              <HardDrive size={12} /> Flush
            </CtrlBtn>
            <CtrlBtn onClick={handleCompact} variant="default">
              <RotateCcw size={12} /> Compact
            </CtrlBtn>
          </div>
        </div>

        {/* ── Key Operations ──────────────────────────────────────────────── */}
        <div className="rounded-xl border border-zinc-700 bg-zinc-900/60 p-4 space-y-3">
          <p className="text-xs font-bold text-zinc-200 uppercase tracking-widest">🔑 Key Operations</p>
          <div className="space-y-2">
            <div>
              <label className="text-[10px] text-zinc-500 uppercase tracking-wider block mb-1">Key</label>
              <input
                value={keyInput}
                onChange={e => setKeyInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSetKey()}
                placeholder="e.g. user:42"
                className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-blue-600 transition"
              />
            </div>
            <div>
              <label className="text-[10px] text-zinc-500 uppercase tracking-wider block mb-1">Value (for SET)</label>
              <input
                value={valueInput}
                onChange={e => setValueInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSetKey()}
                placeholder="e.g. hello world"
                className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-blue-600 transition"
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={handleSetKey}
              disabled={keyLoading || !keyInput.trim() || !valueInput.trim()}
              className="rounded-lg bg-blue-600 py-2 text-xs font-bold text-white hover:bg-blue-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              SET
            </button>
            <button
              onClick={handleGetKey}
              disabled={keyLoading || !keyInput.trim()}
              className="rounded-lg border border-zinc-700 bg-zinc-800 py-2 text-xs font-bold text-zinc-300 hover:bg-zinc-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              GET
            </button>
            <button
              onClick={handleDeleteKey}
              disabled={keyLoading || !keyInput.trim()}
              className="rounded-lg border border-red-800 bg-red-950/20 py-2 text-xs font-bold text-red-400 hover:bg-red-900/40 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              DEL
            </button>
          </div>
          {keyResult && (
            <div className="rounded-lg border border-green-900/50 bg-green-950/20 px-3 py-2 text-xs text-green-300 font-mono break-all">
              {keyResult}
            </div>
          )}
          {keyError && (
            <div className="rounded-lg border border-red-900/50 bg-red-950/20 px-3 py-2 text-xs text-red-300 font-mono">
              {keyError}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}