/**
 * useLogGenerator — Global background log ticker hook.
 *
 * Mounted ONCE in DashboardLayout. Never dies on navigation.
 *
 * ▸ Generates log entries into logStore (persistent buffer)
 * ▸ Normal pace: 1 entry every 2000ms
 * ▸ Load running: 1 entry every 700ms (WAL/STORAGE bias)
 * ▸ WS connected: pauses local generator (WS takes over)
 * ▸ Node count passed in so log entries reference real node names
 */

import { useEffect, useRef } from "react";
import { logStore } from "../store/logStore";
import type { LogLevel, LogComponent } from "../store/logStore";
import { operationsStore } from "../store/operationsStore";

// ── Templates ─────────────────────────────────────────────────────────────────

const TEMPLATES: { level: LogLevel; component: LogComponent; msg: string }[] = [
  // WAL
  { level: "DEBUG", component: "WAL",         msg: "WAL probe: offset={{n}} bytes → key_{{k}}" },
  { level: "INFO",  component: "WAL",         msg: "WAL segment #{{n}} flushed — {{n}} KB in {{n}}ms" },
  { level: "INFO",  component: "WAL",         msg: "WAL rotated: new segment seq={{n}}" },
  { level: "WARN",  component: "WAL",         msg: "WAL write latency elevated: {{n}}ms (threshold=50ms)" },
  // COMPACTION
  { level: "INFO",  component: "COMPACTION",  msg: "Compaction started: L{{n}} → L{{n}} ({{n}} files)" },
  { level: "INFO",  component: "COMPACTION",  msg: "Compaction finished in {{n}}ms — {{n}} tombstones dropped" },
  { level: "DEBUG", component: "COMPACTION",  msg: "Merge pass {{n}}: {{n}} keys written, {{n}} deleted" },
  { level: "WARN",  component: "COMPACTION",  msg: "Compaction queue depth: {{n}} (threshold=5)" },
  // REPLICATION
  { level: "INFO",  component: "REPLICATION", msg: "Replication ACK from {{node}}: seq={{n}}" },
  { level: "WARN",  component: "REPLICATION", msg: "Replication lag to {{node}}: {{n}}ms (high)" },
  { level: "ERROR", component: "REPLICATION", msg: "Replication failure: {{node}} refused write seq={{n}}" },
  { level: "DEBUG", component: "REPLICATION", msg: "Sync heartbeat: {{node}} seq={{n}} lag={{n}}ms" },
  // SNAPSHOT
  { level: "INFO",  component: "SNAPSHOT",    msg: "Snapshot snap-{{n}} created: {{n}} keys captured" },
  { level: "INFO",  component: "SNAPSHOT",    msg: "Snapshot restore complete: {{n}} keys loaded" },
  // HEARTBEAT
  { level: "DEBUG", component: "HEARTBEAT",   msg: "Heartbeat OK: {{node}} rtt={{n}}ms" },
  { level: "WARN",  component: "HEARTBEAT",   msg: "Heartbeat delayed: {{node}} rtt={{n}}ms (threshold=100ms)" },
  { level: "ERROR", component: "HEARTBEAT",   msg: "Heartbeat timeout: {{node}} unreachable after 3 retries" },
  // ELECTION
  { level: "INFO",  component: "ELECTION",    msg: "Leader election initiated by {{node}}" },
  { level: "SUCCESS",component:"ELECTION",    msg: "Leader elected: {{node}} — quorum achieved" },
  // STORAGE — biased during load
  { level: "DEBUG", component: "STORAGE",     msg: "MemTable probe: key_{{k}} → val_{{k}} (seq={{n}})" },
  { level: "INFO",  component: "STORAGE",     msg: "MemTable flushed to SSTable — {{n}} entries in {{n}}ms" },
  { level: "INFO",  component: "STORAGE",     msg: "SSTable L{{n}} created: {{n}} entries, {{n}} MB" },
  { level: "WARN",  component: "STORAGE",     msg: "Bloom false positive: key_{{k}} (fp_rate={{n}}%)" },
  { level: "DEBUG", component: "STORAGE",     msg: "Block cache hit: key_{{k}} (ratio={{n}}%)" },
];

// Load-biased templates (WAL + STORAGE only, higher rate during Generate Load)
const LOAD_TEMPLATES = TEMPLATES.filter(t => t.component === "WAL" || t.component === "STORAGE");

function pickTemplate(loadRunning: boolean) {
  const pool = loadRunning ? LOAD_TEMPLATES : TEMPLATES;
  const r = Math.random();
  const filtered = r < 0.35 ? pool.filter(t => t.level === "DEBUG")
    : r < 0.75 ? pool.filter(t => t.level === "INFO")
    : r < 0.90 ? pool.filter(t => t.level === "WARN")
    : r < 0.97 ? pool.filter(t => t.level === "ERROR")
    : pool.filter(t => t.level === "SUCCESS");
  const source = filtered.length > 0 ? filtered : pool;
  return source[Math.floor(Math.random() * source.length)];
}

function fmtTs() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}:${String(now.getSeconds()).padStart(2,"0")}.${String(now.getMilliseconds()).padStart(3,"0")}`;
}

function interpolate(tpl: string, nodes: string[]): string {
  return tpl
    .replace(/{{k}}/g, String(Math.floor(Math.random() * 9999)))
    .replace(/{{n}}/g, String(Math.floor(Math.random() * 100 + 1)))
    .replace(/{{node}}/g, nodes[Math.floor(Math.random() * nodes.length)] || "node0");
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Mount this ONCE in DashboardLayout.
 * @param nodeNames Live node names from ClusterContext (e.g. ["node0","node1","node2"])
 * @param wsLogsConnected True when Logs page WS is up — pauses local generator
 */
export function useLogGenerator(nodeNames: string[], wsLogsConnected: boolean = false): void {
  const wsRef = useRef(wsLogsConnected);
  wsRef.current = wsLogsConnected;

  useEffect(() => {
    // Seed initial logs if store is empty
    if (logStore.getAll().length === 0) {
      const seeds = Array.from({ length: 20 }, () => {
        const tpl = pickTemplate(false);
        const node = nodeNames.length > 0
          ? nodeNames[Math.floor(Math.random() * nodeNames.length)]
          : "node0";
        return {
          ts: fmtTs(),
          level: tpl.level,
          node,
          component: tpl.component,
          message: interpolate(tpl.msg, nodeNames.length > 0 ? nodeNames : ["node0","node1","node2"]),
        };
      });
      logStore.pushMany(seeds);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function tick() {
      if (wsRef.current) return; // WS active — skip local gen
      const loadRunning = operationsStore.isLoadRunning();
      const interval = loadRunning ? 700 : 2000;

      const tpl = pickTemplate(loadRunning);
      const names = nodeNames.length > 0 ? nodeNames : ["node0","node1","node2"];
      const node = names[Math.floor(Math.random() * names.length)];
      logStore.push({
        ts: fmtTs(),
        level: tpl.level,
        node,
        component: tpl.component,
        message: interpolate(tpl.msg, names),
      });

      // Re-schedule with updated interval
      timerId = setTimeout(tick, interval);
    }

    let timerId = setTimeout(tick, 2000);
    return () => clearTimeout(timerId);
  }, [nodeNames.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
}
