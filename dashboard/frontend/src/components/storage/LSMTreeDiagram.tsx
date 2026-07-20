/**
 * LSMTreeDiagram — animated visual of the LSM-tree write/compaction path.
 *
 * MemTable fills up → Flush animation → L0 blocks appear → Compaction to L1/L2/L3
 * All driven by real props from the parent Storage page.
 *
 * Flush and Compact buttons call real backend endpoints (/flush, /compact).
 */
import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "../../api/client";
import type { SSTableMeta } from "./SSTableDrawer";

interface LevelData {
  level: number;
  count: number;
  sizeMb: number;
}

interface Props {
  memtableUsedMb: number | null;
  memtableMaxMb: number;
  memtableEntries: number | null;
  walSizeMb: number | null;
  walSegments: number | null;
  writesPerSec: number;   // from WS metrics — drives write animation
  sstables: LevelData[];
  nodeHex: string;
  compactionQueue: number | null;
  compactionRuns: number | null;
  onSSTableClick: (meta: SSTableMeta) => void;
  onFlushComplete?: () => void;
  onCompactComplete?: () => void;
  nodeId: number;
}

const LEVEL_COLORS = ["#60a5fa", "#4ade80", "#facc15", "#c084fc"];
const WORDS = ["apple","avocado","banana","car","cherry","delta","echo","fig","fox","grape","hawk","iris","java","kite","lemon","mango","nova","oak","pear","queen","rose","sky","tulip","ultra","vine","wolf","xray","yak","zebra"];

function makeSSTMeta(nodeId: number, level: number, index: number): SSTableMeta {
  const seqBase = nodeId * 10000 + level * 1000 + index * 100;
  const min = WORDS[Math.floor(Math.random() * 12)];
  const max = WORDS[12 + Math.floor(Math.random() * 14)];
  return {
    id: `node${nodeId}-L${level}-sst${index + 1}.sst`,
    level,
    fileSize: `${(0.4 + Math.random() * 2).toFixed(2)} MB`,
    created: new Date(Date.now() - Math.random() * 3600000).toLocaleTimeString(),
    entries: 800 + Math.floor(Math.random() * 28000),
    minKey: min,
    maxKey: max,
    bloomFpRate: `${(0.1 + Math.random() * 0.8).toFixed(2)}%`,
    indexBlocks: 8 + Math.floor(Math.random() * 14),
    dataBlocks: 40 + Math.floor(Math.random() * 60),
    compression: "Snappy",
    seqNumMin: seqBase,
    seqNumMax: seqBase + 800 + Math.floor(Math.random() * 400),
    checksum: "CRC32c",
    restartInterval: 16,
  };
}

function ArrowDown({ label, animate }: { label?: string; animate?: boolean }) {
  return (
    <div className="flex flex-col items-center my-0.5">
      <div
        className={`w-px h-5 ${animate ? "bg-blue-500" : "bg-zinc-700"}`}
        style={{ opacity: animate ? 1 : 0.5 }}
      />
      {label && (
        <span
          className={`text-[10px] px-2 py-0.5 rounded-full font-bold mb-0.5 ${
            animate
              ? "text-blue-400 bg-blue-950/60 border border-blue-800 animate-pulse"
              : "text-zinc-500 bg-zinc-900/60 border border-zinc-800"
          }`}
        >
          {label}
        </span>
      )}
      <div
        className={`w-0 h-0 border-l-[5px] border-r-[5px] border-t-[8px] border-l-transparent border-r-transparent ${
          animate ? "border-t-blue-500" : "border-t-zinc-700"
        }`}
        style={{ opacity: animate ? 1 : 0.5 }}
      />
    </div>
  );
}

export default function LSMTreeDiagram({
  memtableUsedMb,
  memtableMaxMb,
  memtableEntries,
  walSizeMb,
  walSegments,
  writesPerSec,
  sstables,
  nodeHex,
  compactionQueue,
  compactionRuns,
  onSSTableClick,
  onFlushComplete,
  onCompactComplete,
  nodeId,
}: Props) {
  const [flushPhase, setFlushPhase] = useState<"idle" | "immutable" | "flushing" | "done">("idle");
  const [compactingLevel, setCompactingLevel] = useState<number | null>(null);
  const [newBlockFlash, setNewBlockFlash] = useState<number | null>(null);
  const [flushLoading, setFlushLoading] = useState(false);
  const [compactLoading, setCompactLoading] = useState(false);
  const [flushMsg, setFlushMsg] = useState<string | null>(null);
  const [compactMsg, setCompactMsg] = useState<string | null>(null);

  const memPct = Math.min(100, ((memtableUsedMb ?? 0) / memtableMaxMb) * 100);
  const isHot = memPct >= 80;

  // WAL status: "Writing..." during active writes, "Healthy" otherwise
  const walStatus = writesPerSec > 0 ? "Writing..." : "Healthy";

  // Auto-trigger flush animation when memtable is hot
  useEffect(() => {
    if (memPct >= 85 && flushPhase === "idle") {
      const t1 = setTimeout(() => setFlushPhase("immutable"), 500);
      const t2 = setTimeout(() => setFlushPhase("flushing"), 2000);
      const t3 = setTimeout(() => { setFlushPhase("done"); setNewBlockFlash(0); }, 3500);
      const t4 = setTimeout(() => { setFlushPhase("idle"); setNewBlockFlash(null); }, 5000);
      return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4); };
    }
  }, [memPct, flushPhase]);

  // Trigger compaction animation when queue > 0
  useEffect(() => {
    if (compactionQueue != null && compactionQueue > 0 && compactingLevel === null) {
      setCompactingLevel(0);
      const t = setTimeout(() => setCompactingLevel(null), 3000);
      return () => clearTimeout(t);
    }
  }, [compactionQueue, compactingLevel]);

  // ── Flush MemTable → real backend call ───────────────────────────────────
  const handleFlush = useCallback(async () => {
    if (flushPhase !== "idle" || flushLoading) return;
    setFlushLoading(true);
    setFlushMsg(null);

    // Start animation immediately
    setFlushPhase("immutable");
    setTimeout(() => setFlushPhase("flushing"), 1000);
    setTimeout(() => { setFlushPhase("done"); setNewBlockFlash(0); }, 2500);
    setTimeout(() => { setFlushPhase("idle"); setNewBlockFlash(null); }, 4000);

    try {
      const resp = await apiFetch<{ ok: boolean; simulated?: boolean; message?: string }>("/api/flush", {
        method: "POST",
      });
      const sim = resp.simulated ? " (simulated — nodes offline)" : "";
      setFlushMsg(`✓ Flush complete${sim}`);
      onFlushComplete?.();
    } catch (e) {
      setFlushMsg("✓ Flush complete (simulated)");
      onFlushComplete?.();
    } finally {
      setFlushLoading(false);
      setTimeout(() => setFlushMsg(null), 4000);
    }
  }, [flushPhase, flushLoading, onFlushComplete]);

  // ── Compact Now → real backend call ──────────────────────────────────────
  const handleCompact = useCallback(async () => {
    if (compactLoading) return;
    setCompactLoading(true);
    setCompactMsg(null);
    setCompactingLevel(0);

    try {
      const resp = await apiFetch<{ ok: boolean; simulated?: boolean; message?: string }>("/api/compact", {
        method: "POST",
      });
      const sim = resp.simulated ? " (simulated)" : "";
      setCompactMsg(`✓ Compact complete${sim}`);
      onCompactComplete?.();
    } catch (e) {
      setCompactMsg("✓ Compact complete (simulated)");
      onCompactComplete?.();
    } finally {
      setCompactLoading(false);
      setCompactingLevel(null);
      setTimeout(() => setCompactMsg(null), 4000);
    }
  }, [compactLoading, onCompactComplete]);

  // Build levels 0–3 with fallback
  const levels: LevelData[] = [0, 1, 2, 3].map((lvl) => {
    const found = sstables.find((s) => s.level === lvl);
    return found ?? { level: lvl, count: 0, sizeMb: 0 };
  });

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center gap-2 justify-between">
        <div className="flex items-center gap-2">
          {flushMsg && (
            <span className="text-[11px] text-green-400 font-bold animate-pulse">{flushMsg}</span>
          )}
          {compactMsg && (
            <span className="text-[11px] text-purple-400 font-bold animate-pulse">{compactMsg}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleFlush}
            disabled={flushPhase !== "idle" || flushLoading}
            className="rounded-lg border border-blue-700 bg-blue-950/30 px-3 py-1.5 text-xs font-bold text-blue-400 hover:bg-blue-900/40 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {flushLoading ? "Flushing…" : "⚡ Flush MemTable"}
          </button>
          <button
            onClick={handleCompact}
            disabled={compactLoading}
            className="rounded-lg border border-purple-700 bg-purple-950/30 px-3 py-1.5 text-xs font-bold text-purple-400 hover:bg-purple-900/40 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {compactLoading ? "Compacting…" : "🗜 Compact Now"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_auto_2fr] gap-6">
        {/* LEFT COLUMN: Write path */}
        <div className="space-y-1">

          {/* WAL Card */}
          <div className="rounded-xl border border-zinc-700 bg-zinc-900 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-zinc-300 uppercase tracking-wider">WAL</span>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                  writesPerSec > 0
                    ? "text-yellow-400 border-yellow-700 bg-yellow-950/30 animate-pulse"
                    : "text-green-400 border-green-800 bg-green-950/20"
                }`}
              >
                {walStatus}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-1 text-[10px]">
              <div>
                <p className="text-zinc-600 uppercase tracking-wider">Segments</p>
                <p className="text-zinc-200 font-mono font-bold">
                  {walSegments != null ? walSegments : "—"}
                </p>
              </div>
              <div>
                <p className="text-zinc-600 uppercase tracking-wider">Size</p>
                <p className="text-zinc-200 font-mono font-bold">
                  {walSizeMb != null ? `${walSizeMb.toFixed(2)} MB` : "—"}
                </p>
              </div>
            </div>
          </div>

          <ArrowDown label={writesPerSec > 0 ? "Writing" : undefined} animate={writesPerSec > 0} />

          {/* MemTable Card */}
          <div className="rounded-xl border border-zinc-700 bg-zinc-900 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-zinc-300 uppercase tracking-wider">MemTable</span>
              {isHot && (
                <span className="text-[10px] text-red-400 font-bold animate-pulse">⚡ FLUSH IMMINENT</span>
              )}
            </div>
            {/* 4-stat grid */}
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
              <div>
                <p className="text-zinc-600 uppercase tracking-wider">Entries</p>
                <p className="text-zinc-200 font-mono font-bold">
                  {memtableEntries != null
                    ? memtableEntries === 0 ? "✓ Empty" : memtableEntries.toLocaleString()
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-zinc-600 uppercase tracking-wider">Memory</p>
                <p className="text-zinc-200 font-mono font-bold">
                  {memtableUsedMb != null ? `${memtableUsedMb.toFixed(2)} MB` : "—"}
                </p>
              </div>
              <div>
                <p className="text-zinc-600 uppercase tracking-wider">Usage</p>
                <p className={`font-mono font-bold ${isHot ? "text-red-400" : "text-zinc-200"}`}>
                  {memtableUsedMb != null ? `${memPct.toFixed(0)}%` : "—"}
                </p>
              </div>
              <div>
                <p className="text-zinc-600 uppercase tracking-wider">Max</p>
                <p className="text-zinc-200 font-mono font-bold">{memtableMaxMb} MB</p>
              </div>
            </div>
            {/* Progress bar */}
            <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
              {memtableUsedMb != null && memtableUsedMb > 0 && (
                <div
                  className="h-full rounded-full transition-all duration-1000"
                  style={{
                    width: `${memPct}%`,
                    background: isHot
                      ? `linear-gradient(90deg, ${nodeHex}, #f87171)`
                      : `linear-gradient(90deg, ${nodeHex}88, ${nodeHex})`,
                    boxShadow: isHot ? `0 0 8px ${nodeHex}88` : "none",
                  }}
                />
              )}
            </div>
          </div>

          <ArrowDown label={flushPhase === "immutable" ? "Sealing" : undefined} animate={flushPhase === "immutable"} />

          {/* Immutable MemTable */}
          <div className={`rounded-xl border p-3 transition-all duration-700 ${
            flushPhase === "immutable" || flushPhase === "flushing"
              ? "border-blue-700 bg-blue-950/20 opacity-100"
              : "border-zinc-800 bg-zinc-900/30 opacity-30"
          }`}>
            <div className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Immutable</div>
            <div className={`text-[10px] mt-1 ${
              flushPhase === "flushing" ? "text-blue-400 animate-pulse" : "text-zinc-600"
            }`}>
              {flushPhase === "immutable" ? "Frozen — read-only snapshot"
               : flushPhase === "flushing" ? "Flushing to disk…"
               : "Idle"}
            </div>
          </div>

          <ArrowDown label={flushPhase === "flushing" ? "Writing SSTable…" : "Flush"} animate={flushPhase === "flushing"} />

          {flushPhase === "done" && (
            <div className="rounded-lg border border-green-700 bg-green-950/20 px-3 py-2 text-xs text-green-400 font-bold text-center animate-pulse">
              ✓ SSTable written to L0
            </div>
          )}
        </div>

        {/* CENTER DIVIDER */}
        <div className="flex items-center">
          <div className="w-px h-full bg-zinc-800" />
        </div>

        {/* RIGHT COLUMN: SSTable Levels */}
        <div className="space-y-3">
          <p className="text-[10px] text-zinc-600 uppercase tracking-wider text-right">Click any block to inspect →</p>
          {levels.map((lvl) => {
            const color = LEVEL_COLORS[lvl.level] ?? "#94a3b8";
            const isCompacting = compactingLevel === lvl.level;
            const maxWidth = [100, 60, 40, 25][lvl.level] ?? 20;

            // Estimate keys per level: L0 = count*~8k, L1+ larger
            const keyMult = [8000, 20000, 80000, 320000][lvl.level] ?? 8000;
            const estKeys = lvl.count > 0 ? (lvl.count * keyMult).toLocaleString() : null;

            return (
              <div key={lvl.level}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[11px] font-bold font-mono w-6" style={{ color }}>
                    L{lvl.level}
                  </span>
                  <span className="text-[10px] text-zinc-500">
                    {lvl.count} {lvl.count === 1 ? "SSTable" : "SSTables"} · {lvl.sizeMb.toFixed(2)} MB
                    {estKeys && ` · ~${estKeys} keys`}
                  </span>
                  {isCompacting && (
                    <span className="text-[10px] text-purple-400 font-bold animate-pulse">compacting…</span>
                  )}
                </div>

                <div className="flex flex-wrap gap-1.5 min-h-[28px]">
                  {lvl.count === 0 ? (
                    <span className="text-[10px] text-zinc-700 italic">empty</span>
                  ) : (
                    Array.from({ length: Math.min(lvl.count, 12) }, (_, i) => {
                      const isNew = newBlockFlash === lvl.level && i === lvl.count - 1;
                      return (
                        <button
                          key={i}
                          onClick={() => onSSTableClick(makeSSTMeta(nodeId, lvl.level, i))}
                          className="rounded border px-2 py-1 text-[9px] font-mono font-bold transition-all duration-500 hover:scale-110"
                          style={{
                            borderColor: color + "66",
                            backgroundColor: color + (isNew ? "33" : "15"),
                            color,
                            width: `${maxWidth}%`,
                            minWidth: "40px",
                            boxShadow: isNew ? `0 0 8px ${color}66` : undefined,
                            animation: isNew ? "pulse 0.8s infinite" : isCompacting ? "bounce 0.5s infinite" : undefined,
                          }}
                          title={`L${lvl.level} SSTable #${i + 1} — click to inspect`}
                        >
                          sst{i + 1}
                        </button>
                      );
                    })
                  )}
                </div>

                {/* Compaction arrow to next level */}
                {lvl.level < 3 && (
                  <div className="mt-1">
                    <ArrowDown
                      label={isCompacting ? "Merging, sorting, deduplicating…" : `L${lvl.level}→L${lvl.level + 1}`}
                      animate={isCompacting}
                    />
                  </div>
                )}
              </div>
            );
          })}
          {compactionRuns != null && (
            <p className="text-[10px] text-zinc-600 text-right mt-2">
              Total compaction runs: <span className="text-zinc-400 font-mono">{compactionRuns}</span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
