/**
 * Logs — Production-grade terminal console.
 *
 * - Terminal font + pitch-black background
 * - Component filter chips: [WAL] [REPLICATION] [COMPACTION] [SNAPSHOT] [HEARTBEAT] [ELECTION]
 * - Timeline sidebar with colored event dots
 * - Export: Download JSON + Copy to clipboard
 * - SUCCESS level (green) for recovery/election
 * - Slide-in animation for new log lines
 * - Blinking cursor at end of pane
 * - Chaos events injected with proper component tags
 */
import { useState, useEffect, useRef } from "react";
import SectionHeader from "../components/SectionHeader";
import { eventBus } from "../services/eventBus";
import { getLogs } from "../api/live";
import type { ClusterEvent } from "../types/failure";
import { useCluster } from "../context/ClusterContext";
import LiveBadge from "../components/LiveBadge";
import { useLogStore, logStore } from "../store/logStore";
import type { LogEntry as StoreLogEntry } from "../store/logStore";

// ── Types ────────────────────────────────────────────────────────────────────
type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR" | "SUCCESS";
type Component = "WAL" | "REPLICATION" | "COMPACTION" | "SNAPSHOT" | "HEARTBEAT" | "ELECTION" | "STORAGE" | "CLUSTER";

interface LogEntry {
  id: number;
  ts: string;
  level: LogLevel;
  node: string;
  component: Component;
  message: string;
  isNew?: boolean;
}

// ── Rich log templates with components ───────────────────────────────────────
const TEMPLATES: { level: LogLevel; component: Component; msg: string }[] = [
  // WAL
  { level: "DEBUG", component: "WAL",         msg: "WAL probe: offset={{n}} bytes → {{k}}" },
  { level: "INFO",  component: "WAL",         msg: "WAL segment #{{n}} flushed — {{s}} KB in {{n}}ms" },
  { level: "INFO",  component: "WAL",         msg: "WAL rotated: new segment seq={{s}}" },
  { level: "WARN",  component: "WAL",         msg: "WAL write latency elevated: {{n}}ms (threshold=50ms)" },
  // COMPACTION
  { level: "INFO",  component: "COMPACTION",  msg: "Compaction started: L{{n}} → L{{n}} ({{n}} files)" },
  { level: "INFO",  component: "COMPACTION",  msg: "Compaction finished in {{n}}ms — {{n}} tombstones dropped" },
  { level: "DEBUG", component: "COMPACTION",  msg: "Merge pass {{n}}: {{n}} keys written, {{n}} deleted" },
  { level: "WARN",  component: "COMPACTION",  msg: "Compaction queue depth: {{n}} (threshold=5)" },
  // REPLICATION
  { level: "INFO",  component: "REPLICATION", msg: "Replication ACK from {{node}}: seq={{s}}" },
  { level: "WARN",  component: "REPLICATION", msg: "Replication lag to {{node}}: {{n}}ms (high)" },
  { level: "ERROR", component: "REPLICATION", msg: "Replication failure: {{node}} refused write seq={{s}}" },
  { level: "DEBUG", component: "REPLICATION", msg: "Sync heartbeat: {{node}} seq={{s}} lag={{n}}ms" },
  // SNAPSHOT
  { level: "INFO",  component: "SNAPSHOT",    msg: "Snapshot snap-{{s}} created: {{n}} keys captured" },
  { level: "INFO",  component: "SNAPSHOT",    msg: "Snapshot restore complete: {{n}} keys loaded" },
  { level: "DEBUG", component: "SNAPSHOT",    msg: "Snapshot GC: retaining {{n}} snapshots, removed {{n}}" },
  // HEARTBEAT
  { level: "DEBUG", component: "HEARTBEAT",   msg: "Heartbeat OK: {{node}} rtt={{n}}ms" },
  { level: "WARN",  component: "HEARTBEAT",   msg: "Heartbeat delayed: {{node}} rtt={{n}}ms (threshold=100ms)" },
  { level: "ERROR", component: "HEARTBEAT",   msg: "Heartbeat timeout: {{node}} unreachable after 3 retries" },
  // ELECTION
  { level: "INFO",  component: "ELECTION",    msg: "Leader election initiated by {{node}}" },
  { level: "SUCCESS", component: "ELECTION",  msg: "Leader elected: {{node}} — quorum achieved" },
  { level: "INFO",  component: "ELECTION",    msg: "Replica {{node}} promoted to primary" },
  // STORAGE
  { level: "DEBUG", component: "STORAGE",     msg: "MemTable probe: key_{{k}} → {{k}} (seq={{s}})" },
  { level: "INFO",  component: "STORAGE",     msg: "MemTable flushed to SSTable — {{n}} entries in {{n}}ms" },
  { level: "INFO",  component: "STORAGE",     msg: "SSTable L{{n}} created: {{n}} entries, {{n}} MB" },
  { level: "WARN",  component: "STORAGE",     msg: "Bloom false positive: key_{{k}} (fp_rate={{n}}%)" },
  { level: "DEBUG", component: "STORAGE",     msg: "Block cache hit: {{k}} (ratio={{n}}%)" },
];

// Weighted sampling: pick a template weighted toward INFO/DEBUG
function pickTemplate() {
  const r = Math.random();
  const pool = r < 0.35 ? TEMPLATES.filter(t => t.level === "DEBUG")
    : r < 0.75 ? TEMPLATES.filter(t => t.level === "INFO")
    : r < 0.90 ? TEMPLATES.filter(t => t.level === "WARN")
    : r < 0.97 ? TEMPLATES.filter(t => t.level === "ERROR")
    : TEMPLATES.filter(t => t.level === "SUCCESS");
  return pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : TEMPLATES[0];
}

let _id = 0;


function ts() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}:${String(now.getSeconds()).padStart(2,"0")}.${String(now.getMilliseconds()).padStart(3,"0")}`;
}

function interpolate(tpl: string, nodes: string[]): string {
  return tpl
    .replace(/{{k}}/g, `key_${Math.floor(Math.random() * 9999)}`)
    .replace(/{{s}}/g, String(Math.floor(Math.random() * 999)))
    .replace(/{{n}}/g, String(Math.floor(Math.random() * 100 + 1)))
    .replace(/{{node}}/g, nodes[Math.floor(Math.random() * nodes.length)] || "node0");
}

function generateLog(nodeNames: string[]): LogEntry {
  const tpl = pickTemplate();
  const node = nodeNames[Math.floor(Math.random() * nodeNames.length)] || "node0";
  return {
    id: _id++,
    ts: ts(),
    level: tpl.level,
    node,
    component: tpl.component,
    message: interpolate(tpl.msg, nodeNames),
    isNew: true,
  };
}

function clusterEventToLog(ev: ClusterEvent, _nodeNames?: string[]): LogEntry {
  void _nodeNames;

  const level: LogLevel =
    ev.type === "FAILURE_INJECTED" || ev.nodeState === "UNREACHABLE" ? "ERROR"
    : ev.type === "PARTITION_CREATED" || ev.nodeState === "SUSPECT" ? "WARN"
    : ev.nodeState === "RECOVERING" || ev.type === "PARTITION_HEALED" ? "SUCCESS"
    : "INFO";
  const component: Component =
    ev.type === "PARTITION_CREATED" || ev.type === "PARTITION_HEALED" ? "REPLICATION"
    : ev.nodeState === "UNREACHABLE" ? "HEARTBEAT"
    : ev.nodeState === "RECOVERING" ? "ELECTION"
    : ev.type === "REBALANCE_STARTED" ? "COMPACTION"
    : "CLUSTER";
  return {
    id: _id++,
    ts: ts(),
    level,
    node: ev.nodeId !== undefined ? `node${ev.nodeId}` : "cluster",
    component,
    message: ev.message,
    isNew: true,
  };
}

// ── Styles ───────────────────────────────────────────────────────────────────
const LEVEL_COLOR: Record<LogLevel, string> = {
  DEBUG:   "#52525b",
  INFO:    "#60a5fa",
  WARN:    "#fbbf24",
  ERROR:   "#f87171",
  SUCCESS: "#4ade80",
};

const COMPONENT_COLOR: Record<Component, string> = {
  WAL:         "#fb923c",
  REPLICATION: "#c084fc",
  COMPACTION:  "#2dd4bf",
  SNAPSHOT:    "#60a5fa",
  HEARTBEAT:   "#f87171",
  ELECTION:    "#4ade80",
  STORAGE:     "#facc15",
  CLUSTER:     "#94a3b8",
};

const ALL_COMPONENTS: Component[] = ["WAL", "REPLICATION", "COMPACTION", "SNAPSHOT", "HEARTBEAT", "ELECTION", "STORAGE", "CLUSTER"];
const ALL_LEVELS: LogLevel[] = ["DEBUG", "INFO", "WARN", "ERROR", "SUCCESS"];
const MAX_LINES = 300;

// ── Page ─────────────────────────────────────────────────────────────────────
export default function Logs() {
  const { nodes: runtimeNodes } = useCluster();
  const nodeNames = runtimeNodes.map((n) => n.name || `node${n.id}`);

  // Read from global persistent logStore (never resets on navigation)
  const storeLogs = useLogStore();

  // Map StoreLogEntry → local LogEntry shape (they match, just alias)
  const logs: LogEntry[] = storeLogs as LogEntry[];

  const [paused, setPaused] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [search, setSearch] = useState("");
  const [activeLevels, setActiveLevels] = useState<Set<LogLevel>>(new Set(ALL_LEVELS));
  const [activeComponents, setActiveComponents] = useState<Set<Component>>(new Set(ALL_COMPONENTS));
  const [activeNode, setActiveNode] = useState<string>("all");
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Subscribe to cluster events — also write to global logStore
  useEffect(() => {
    const handler = (ev: ClusterEvent) => {
      const entry = clusterEventToLog(ev, nodeNames);
      logStore.push(entry);
    };
    eventBus.subscribe(handler);
    return () => eventBus.unsubscribe(handler);
  }, [nodeNames.join(",")]);

  // Fallback local generator is now in DashboardLayout (useLogGenerator)
  // wsConnected is declared below and used in JSX

  // Backend seed: fetch last 50 log entries on mount (writes to global logStore)
  useEffect(() => {
    let mounted = true;
    async function fetchBackendLogs() {
      try {
        const data = await getLogs(50);
        if (!mounted) return;
        const mapped: StoreLogEntry[] = data.map((e) => ({
          id: e.id,
          ts: e.ts,
          level: e.level as StoreLogEntry["level"],
          node: e.node,
          component: (e.component as StoreLogEntry["component"]) ?? "CLUSTER",
          message: e.message,
        }));
        logStore.seed(mapped);
      } catch { /* backend offline */ }
    }
    fetchBackendLogs();
    return () => { mounted = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // WS /ws/logs — writes to global logStore instead of local state
  const wsLogsRef = useRef<WebSocket | null>(null);
  const wsReconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [wsConnected, setWsConnected] = useState(false);

  useEffect(() => {
    function connect() {
      if (wsLogsRef.current && wsLogsRef.current.readyState < 2) return;
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${window.location.host}/ws/logs`);
      wsLogsRef.current = ws;
      ws.onopen = () => setWsConnected(true);
      ws.onmessage = (ev) => {
        if (paused) return;
        try {
          const e = JSON.parse(ev.data);
          logStore.push({
            ts: e.ts,
            level: (e.level as StoreLogEntry["level"]) ?? "INFO",
            node: e.node ?? "node0",
            component: (e.component as StoreLogEntry["component"]) ?? "CLUSTER",
            message: e.message ?? "",
            isNew: true,
          });
        } catch { /* ignore */ }
      };
      ws.onerror = () => ws.close();
      ws.onclose = () => {
        wsLogsRef.current = null;
        setWsConnected(false);
        wsReconnectRef.current = setTimeout(connect, 3000);
      };
    }
    connect();
    return () => {
      if (wsReconnectRef.current) clearTimeout(wsReconnectRef.current);
      if (wsLogsRef.current) {
        wsLogsRef.current.onclose = null;
        wsLogsRef.current.close();
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]);


  // Note: fallback log generator now lives in DashboardLayout (useLogGenerator hook)
  // It writes to logStore which this component reads reactively via useLogStore()

  // Auto-scroll
  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs, autoScroll]);

  // Filter
  const filtered = logs.filter((l) => {
    if (!activeLevels.has(l.level)) return false;
    if (!activeComponents.has(l.component)) return false;
    if (activeNode !== "all" && l.node !== activeNode) return false;
    if (search && !l.message.toLowerCase().includes(search.toLowerCase()) &&
        !l.node.includes(search) && !l.component.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // Counts
  const levelCounts: Record<LogLevel, number> = { DEBUG: 0, INFO: 0, WARN: 0, ERROR: 0, SUCCESS: 0 };
  logs.forEach((l) => levelCounts[l.level]++);

  // Export
  function downloadLogs() {
    const blob = new Blob([JSON.stringify(filtered, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `cluster-logs-${Date.now()}.json`; a.click();
    URL.revokeObjectURL(url);
  }

  function copyLogs() {
    const text = filtered.map((l) => `${l.ts}  ${l.level.padEnd(7)}  [${l.component.padEnd(11)}]  ${l.node.padEnd(6)}  ${l.message}`).join("\n");
    navigator.clipboard.writeText(text).catch(() => {});
  }

  // Toggle helpers
  function toggleLevel(lvl: LogLevel) {
    setActiveLevels((prev) => {
      const next = new Set(prev);
      if (next.has(lvl)) { if (next.size > 1) next.delete(lvl); } else next.add(lvl);
      return next;
    });
  }
  function toggleComponent(c: Component) {
    setActiveComponents((prev) => {
      const next = new Set(prev);
      if (next.has(c)) { if (next.size > 1) next.delete(c); } else next.add(c);
      return next;
    });
  }

  // Timeline events (significant events only)
  const timelineEvents = logs.filter(l => l.level === "ERROR" || l.level === "SUCCESS" || l.level === "WARN").slice(-20);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <SectionHeader title="Logs" subtitle="Production terminal console — live streaming from all cluster nodes" />
        <div className="flex items-center gap-3 mt-1 shrink-0">
          <LiveBadge mode="websocket" wsConnected={wsConnected} refreshLabel="Stream" />
          <span className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold ${
            paused ? "border-zinc-700 text-zinc-500"
            : wsConnected ? "border-green-700 bg-green-950/50 text-green-400"
            : "border-yellow-700 bg-yellow-950/30 text-yellow-500"
          }`}>
            <span className={`h-2 w-2 rounded-full ${
              paused ? "bg-zinc-600" : wsConnected ? "bg-green-400" : "bg-yellow-500"
            }`}
              style={{ animation: paused ? "none" : "pulse 1.5s infinite" }} />
            {paused ? "Paused" : wsConnected ? "● LIVE · /ws/logs" : "● FALLBACK · simulated"}
          </span>
        </div>
      </div>

      {/* Level summary tiles */}
      <div className="grid grid-cols-5 gap-2">
        {ALL_LEVELS.map((lvl) => (
          <button
            key={lvl}
            onClick={() => toggleLevel(lvl)}
            className={`rounded-xl p-3 text-center border transition ${
              activeLevels.has(lvl) ? "border-transparent" : "border-zinc-800 opacity-40"
            }`}
            style={activeLevels.has(lvl) ? { borderColor: LEVEL_COLOR[lvl] + "44", backgroundColor: LEVEL_COLOR[lvl] + "11" } : {}}
          >
            <p className="text-[10px] uppercase tracking-wider" style={{ color: LEVEL_COLOR[lvl] }}>{lvl}</p>
            <p className="text-xl font-bold mt-1" style={{ color: LEVEL_COLOR[lvl] }}>{levelCounts[lvl]}</p>
          </button>
        ))}
      </div>

      {/* Component chips */}
      <div className="flex flex-wrap gap-1.5">
        {ALL_COMPONENTS.map((c) => (
          <button
            key={c}
            onClick={() => toggleComponent(c)}
            className={`rounded-full border px-3 py-1 text-[10px] font-bold transition ${
              activeComponents.has(c) ? "opacity-100" : "opacity-30"
            }`}
            style={activeComponents.has(c) ? {
              borderColor: COMPONENT_COLOR[c] + "66",
              backgroundColor: COMPONENT_COLOR[c] + "15",
              color: COMPONENT_COLOR[c],
            } : { borderColor: "#3f3f46", color: "#52525b" }}
          >
            [{c}]
          </button>
        ))}
        <button
          onClick={() => setActiveComponents(new Set(ALL_COMPONENTS))}
          className="rounded-full border border-zinc-700 px-3 py-1 text-[10px] text-zinc-500 hover:text-zinc-300 transition"
        >
          All
        </button>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="Search logs, nodes, components…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] rounded-lg border border-zinc-700 bg-zinc-900/80 px-4 py-2 text-sm font-mono text-white placeholder-zinc-600 focus:border-blue-600 focus:outline-none"
        />
        <select
          value={activeNode}
          onChange={(e) => setActiveNode(e.target.value)}
          className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-300"
        >
          <option value="all">All nodes</option>
          {runtimeNodes.map((n) => (
            <option key={n.id} value={n.name || `node${n.id}`}>{n.name || `node${n.id}`}</option>
          ))}
        </select>
        <button
          onClick={() => setPaused((p) => !p)}
          className={`rounded-lg border px-3 py-2 text-xs font-bold transition ${
            paused ? "border-green-700 bg-green-950/30 text-green-400" : "border-zinc-700 text-zinc-400 hover:border-zinc-500"
          }`}
        >
          {paused ? "▶ Resume" : "⏸ Pause"}
        </button>
        <button
          onClick={() => setAutoScroll((a) => !a)}
          className={`rounded-lg border px-3 py-2 text-xs font-bold transition ${
            autoScroll ? "border-blue-700 bg-blue-950/30 text-blue-400" : "border-zinc-700 text-zinc-500"
          }`}
        >
          {autoScroll ? "↓ Auto-scroll" : "↓ Manual"}
        </button>
        <button onClick={downloadLogs} className="rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-400 hover:text-blue-400 hover:border-blue-700 transition">
          ↓ Export
        </button>
        <button onClick={copyLogs} className="rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-400 hover:text-zinc-300 transition">
          Copy
        </button>
        <button onClick={() => logStore.clear()} className="rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-500 hover:text-red-400 hover:border-red-700 transition">
          Clear
        </button>
      </div>

      {/* Main layout: log pane + timeline sidebar */}
      <div className="flex gap-4">
        {/* Log pane */}
        <div
          ref={containerRef}
          className="flex-1 rounded-xl border border-zinc-800 overflow-y-auto"
          style={{ height: 520, backgroundColor: "#080808" }}
        >
          <div className="p-3 space-y-[2px] font-mono text-[11px]">
            {filtered.length === 0 ? (
              <p className="text-zinc-600 text-center py-12">No entries match your filters.</p>
            ) : (
              filtered.map((log) => (
                <div
                  key={log.id}
                  className="flex items-start gap-2 py-[2px] px-1 rounded hover:bg-zinc-900/40 transition-colors"
                  style={{ animation: log.isNew ? "slideInLog 0.3s ease-out" : undefined }}
                >
                  {/* Timestamp */}
                  <span className="shrink-0 text-zinc-700 w-28 tabular-nums">{log.ts}</span>
                  {/* Level */}
                  <span
                    className="shrink-0 w-16 font-bold"
                    style={{ color: LEVEL_COLOR[log.level] }}
                  >
                    {log.level}
                  </span>
                  {/* Component */}
                  <span
                    className="shrink-0 w-28 font-bold"
                    style={{ color: COMPONENT_COLOR[log.component] }}
                  >
                    [{log.component}]
                  </span>
                  {/* Node */}
                  <span className="shrink-0 text-zinc-600 w-14">{log.node}</span>
                  {/* Message */}
                  <span style={{ color: LEVEL_COLOR[log.level] === "#52525b" ? "#52525b" : undefined }}
                    className={
                      log.level === "ERROR" ? "text-red-300"
                      : log.level === "WARN" ? "text-yellow-200"
                      : log.level === "SUCCESS" ? "text-green-300"
                      : log.level === "INFO" ? "text-zinc-300"
                      : "text-zinc-600"
                    }
                  >
                    {log.message}
                  </span>
                </div>
              ))
            )}
            {/* Blinking cursor */}
            {!paused && (
              <div className="flex items-start gap-2 py-[2px] px-1">
                <span className="text-zinc-700 w-28">　</span>
                <span className="text-green-400 font-bold" style={{ animation: "blink 1s step-end infinite" }}>█</span>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* Timeline sidebar */}
        <div className="w-36 flex flex-col items-center py-2 gap-1 shrink-0">
          <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-2">Timeline</p>
          <div className="flex flex-col items-center gap-0 flex-1">
            {timelineEvents.slice(-15).map((ev, i) => (
              <div key={ev.id} className="flex flex-col items-center">
                {i > 0 && <div className="w-px h-3" style={{ backgroundColor: "#27272a" }} />}
                <div
                  className="h-2.5 w-2.5 rounded-full border-2"
                  style={{
                    borderColor: LEVEL_COLOR[ev.level],
                    backgroundColor: LEVEL_COLOR[ev.level] + "33",
                  }}
                  title={`${ev.ts} [${ev.component}] ${ev.message}`}
                />
              </div>
            ))}
            {timelineEvents.length === 0 && (
              <div className="text-[9px] text-zinc-700 text-center mt-8">No events<br/>yet</div>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <p className="text-xs text-zinc-600 text-right">
        {filtered.length} of {logs.length} entries
        {wsConnected ? (
          <span className="text-green-600 ml-2">· 🟢 /ws/logs connected</span>
        ) : (
          <span className="text-zinc-700 ml-2">· 🟡 fallback generator</span>
        )}
        {" "}&middot; {runtimeNodes.length} nodes streaming
      </p>

      <style>{`
        @keyframes slideInLog {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0; }
        }
      `}</style>
    </div>
  );
}