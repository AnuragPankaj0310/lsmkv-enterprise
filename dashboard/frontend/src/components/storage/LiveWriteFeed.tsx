/**
 * LiveWriteFeed — terminal-style write stream ⭐
 *
 * Shows live key tokens falling into the MemTable, driven by:
 *   1. Real writes/sec from /ws/metrics WebSocket
 *   2. Token spawn rate = actual writes/sec, capped at 20 visual/s
 *
 * No "Inject Writes" button — controls live on Dashboard.
 *
 * Terminal log format: 18:42:11 · SET key_1001 · Committed · 2ms
 */
import { useState, useEffect, useRef, useCallback } from "react";

interface WriteToken {
  id: number;
  key: string;
  latencyMs: number;
  y: number;          // 0 → 100 (animation progress)
  done: boolean;
  xOffset: number;
}

interface WriteLogEntry {
  id: number;
  key: string;
  latencyMs: number;
  ts: string;
}

interface Props {
  memtableUsedMb: number;
  memtableMaxMb: number;
  nodeHex: string;
  nodeId: number;
  writesPerSec?: number;  // Can be passed from parent (already connected to WS)
  loadRunning?: boolean;  // True when Generate Load is active from any page
}


let _keySeq = 1000;
function nextKey() {
  return `key_${_keySeq++}`;
}

function nowTs() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}:${String(d.getSeconds()).padStart(2,"0")}`;
}

export default function LiveWriteFeed({ memtableUsedMb, memtableMaxMb, nodeHex, nodeId, writesPerSec: propWps, loadRunning = false }: Props) {
  const [tokens, setTokens]       = useState<WriteToken[]>([]);
  const [writeLog, setWriteLog]   = useState<WriteLogEntry[]>([]);
  const [writesPerSec, setWritesPerSec] = useState(propWps ?? 0);
  const [wsConnected, setWsConnected]   = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const animRef = useRef<number | null>(null);
  const nextIdRef = useRef(0);

  const memPct = Math.min(100, (memtableUsedMb / memtableMaxMb) * 100);
  const isHot  = memPct >= 80;

  // Sync with prop if parent passes writesPerSec
  useEffect(() => {
    if (propWps !== undefined) setWritesPerSec(propWps);
  }, [propWps]);

  // WS metrics — only connect if parent doesn't provide writesPerSec
  useEffect(() => {
    if (propWps !== undefined) return; // parent handles WS
    function connect() {
      if (wsRef.current && wsRef.current.readyState < 2) return;
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${window.location.host}/ws/metrics`);
      wsRef.current = ws;
      ws.onopen = () => setWsConnected(true);
      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          if (Array.isArray(data)) {
            const total = data.reduce((s: number, n: any) => s + (n.writes_per_sec ?? 0), 0);
            setWritesPerSec(Math.round(total));
          } else if (data.nodes) {
            const total = Object.values(data.nodes as Record<string, any>).reduce(
              (s: number, n: any) => s + (n.writes_per_sec ?? 0), 0
            );
            setWritesPerSec(Math.round(total as number));
          }
        } catch { /* ignore */ }
      };
      ws.onerror = () => ws.close();
      ws.onclose = () => {
        wsRef.current = null;
        setWsConnected(false);
        setTimeout(connect, 4000);
      };
    }
    connect();
    return () => { if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close(); } };
  }, [propWps]);

  // Spawn tokens proportional to writes/sec, max 20/s visual, min 1 every 2s when idle
  const spawnToken = useCallback(() => {
    const key = nextKey();
    const latencyMs = 1 + Math.floor(Math.random() * 8);
    const tok: WriteToken = {
      id: nextIdRef.current++,
      key,
      latencyMs,
      y: 0,
      done: false,
      xOffset: (nextIdRef.current % 9 - 4) * 22,
    };
    setTokens((prev) => [...prev.slice(-20), tok]);
  }, []);

  useEffect(() => {
    // Visual rate: proportional to writesPerSec, clamped 0.5/s–20/s
    // When loadRunning is true from ops store, treat as at least medium activity
    const effectiveWps = loadRunning && writesPerSec === 0 ? 8 : writesPerSec;
    const vRate = effectiveWps > 0
      ? Math.min(effectiveWps, 20)
      : 0.5; // idle: 1 token every 2s
    const intervalMs = Math.round(1000 / vRate);
    const t = setInterval(spawnToken, intervalMs);
    return () => clearInterval(t);
  }, [writesPerSec, spawnToken]);

  // Animate token fall
  useEffect(() => {
    function tick() {
      setTokens((prev) => {
        const next = prev.map((t) => {
          if (t.done) return t;
          const step = writesPerSec > 5 ? 5 : 3; // faster during high load
          const ny = t.y + step;
          if (ny >= 100) {
            // Token arrived at MemTable — add to write log
            setWriteLog((wl) => {
              const entry: WriteLogEntry = {
                id: t.id,
                key: t.key,
                latencyMs: t.latencyMs,
                ts: nowTs(),
              };
              return [entry, ...wl].slice(0, 12);
            });
            return { ...t, y: 100, done: true };
          }
          return { ...t, y: ny };
        });
        return next.filter((t) => t.y < 110);
      });
      animRef.current = requestAnimationFrame(tick);
    }
    animRef.current = requestAnimationFrame(tick);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [writesPerSec]);

  const connected = propWps !== undefined ? true : wsConnected;
  const rateLabel = writesPerSec > 0
    ? `${writesPerSec} w/s · Live`
    : "Idle · waiting for writes";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-zinc-300 uppercase tracking-wider">
          ⚡ Live Write Feed
        </h3>
        <div className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold ${
          connected
            ? writesPerSec > 0
              ? "border-green-700 bg-green-950/30 text-green-400"
              : "border-zinc-700 bg-zinc-900/30 text-zinc-500"
            : "border-zinc-800 text-zinc-700"
        }`}>
          <span className={`h-1.5 w-1.5 rounded-full ${
            writesPerSec > 0 ? "bg-green-400" : "bg-zinc-500"
          }`}
            style={{ animation: writesPerSec > 0 ? "pulse 1s infinite" : "none" }}
          />
          {rateLabel}
        </div>
      </div>

      {/* Animation canvas */}
      <div className="rounded-xl border border-zinc-800 bg-[#080808] overflow-hidden relative" style={{ height: 180 }}>
        {/* Labels */}
        <div className="absolute top-2 left-3 text-[9px] text-zinc-700 font-mono uppercase tracking-wider">
          Client Writes
        </div>
        <div className="absolute bottom-2 left-3 text-[9px] font-bold uppercase tracking-wider"
          style={{ color: nodeHex + "aa" }}>
          MemTable · node{nodeId}
        </div>

        {/* MemTable fill bar */}
        <div className="absolute bottom-0 left-0 right-0 h-8 bg-zinc-900/80">
          <div
            className="absolute bottom-0 left-0 top-0 rounded-sm transition-all duration-1000"
            style={{
              width: `${memPct}%`,
              background: isHot
                ? `linear-gradient(90deg, ${nodeHex}66, #f8717166)`
                : `linear-gradient(90deg, ${nodeHex}22, ${nodeHex}55)`,
            }}
          />
          <div className="absolute inset-0 flex items-center px-3 gap-2">
            <span className="text-[9px] font-mono font-bold" style={{ color: nodeHex }}>
              {memPct.toFixed(0)}% full
            </span>
            {isHot && (
              <span className="text-[9px] text-red-400 font-bold animate-pulse">⚡ FLUSH IMMINENT</span>
            )}
          </div>
        </div>

        {/* Falling key tokens */}
        {tokens.filter((t) => !t.done).map((tok) => (
          <div
            key={tok.id}
            className="absolute px-2 py-0.5 rounded-full border text-[10px] font-mono font-bold pointer-events-none"
            style={{
              left: "50%",
              top: `${Math.min(tok.y, 72)}%`,
              transform: `translateX(calc(-50% + ${tok.xOffset}px))`,
              borderColor: nodeHex + "66",
              backgroundColor: nodeHex + "18",
              color: nodeHex,
              opacity: tok.y < 10 ? tok.y / 10 : tok.y > 65 ? (80 - tok.y) / 15 : 1,
              transition: "top 16ms linear",
              whiteSpace: "nowrap",
            }}
          >
            {tok.key}
          </div>
        ))}
      </div>

      {/* Terminal log */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-950 overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800 bg-zinc-900/60">
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold">
            WAL → MemTable Commit Log
          </span>
          <span className="text-[10px] text-zinc-700">node{nodeId}</span>
        </div>
        <div className="font-mono text-[10px] divide-y divide-zinc-900 max-h-48 overflow-y-auto">
          {writeLog.length === 0 ? (
            <div className="px-3 py-4 text-zinc-700 text-center">Waiting for writes…</div>
          ) : (
            writeLog.map((entry) => (
              <div key={entry.id} className="flex items-center gap-3 px-3 py-1.5 hover:bg-zinc-900/40 transition-colors">
                <span className="text-zinc-600 shrink-0 w-16">{entry.ts}</span>
                <span className="text-cyan-500 shrink-0 font-bold w-8 text-[9px]">SET</span>
                <span className="text-zinc-300 flex-1 truncate">{entry.key}</span>
                <span className="text-green-500 shrink-0 font-bold text-[9px]">Committed</span>
                <span className="text-zinc-600 shrink-0">{entry.latencyMs}ms</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
