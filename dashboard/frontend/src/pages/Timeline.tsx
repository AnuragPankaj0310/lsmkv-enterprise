/**
 * Timeline — Flight Recorder + Replay ⭐⭐⭐⭐⭐
 *
 * Records every cluster state change with timestamp.
 * VCR controls: ⏮ ◀ ⏸/▶ ▶ ⏭ + scrubber slider + speed selector.
 * During playback every other page reacts (all read from useCluster).
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { useCluster } from "../context/ClusterContext";
import type { ClusterSnapshot } from "../context/ClusterContext";
import SectionHeader from "../components/SectionHeader";

// ── Event label → display config ─────────────────────────────────────────────
function labelColor(snap: ClusterSnapshot): string {
  const s = snap.label.toLowerCase();
  if (s.includes("unreachable") || s.includes("crash") || s.includes("failure")) return "#f87171";
  if (s.includes("partition")) return "#fb923c";
  if (s.includes("rebalance")) return "#c084fc";
  if (s.includes("recover") || s.includes("elect")) return "#4ade80";
  if (s.includes("suspect") || s.includes("warn")) return "#fbbf24";
  return "#60a5fa";
}

function labelIcon(snap: ClusterSnapshot): string {
  const s = snap.label.toLowerCase();
  if (s.includes("unreachable") || s.includes("crash")) return "💀";
  if (s.includes("failure")) return "⚡";
  if (s.includes("partition")) return "✂";
  if (s.includes("healed")) return "🔗";
  if (s.includes("rebalance")) return "⚖";
  if (s.includes("recover")) return "✓";
  if (s.includes("elect")) return "👑";
  return "•";
}

function formatTime(epochMs: number): string {
  const d = new Date(epochMs);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

function describeSnapshot(snap: ClusterSnapshot): string {
  if (snap.label !== "periodic" && snap.label !== "state-change") return snap.label;
  const downCount = snap.nodes.filter((n) => n.state === "UNREACHABLE").length;
  const suspectCount = snap.nodes.filter((n) => n.state === "SUSPECT").length;
  const partCount = snap.partitions.length;
  const rebalCount = snap.nodes.filter((n) => n.state === "REBALANCING").length;
  if (downCount > 0) return `${downCount} node(s) UNREACHABLE`;
  if (partCount > 0) return `${partCount} partition(s) active`;
  if (rebalCount > 0) return `${rebalCount} node(s) rebalancing`;
  if (suspectCount > 0) return `${suspectCount} node(s) suspect`;
  return "Cluster healthy";
}

// ── Node state badges ─────────────────────────────────────────────────────────
const STATE_DOT: Record<string, string> = {
  HEALTHY:     "#4ade80",
  SUSPECT:     "#fbbf24",
  UNREACHABLE: "#f87171",
  REBALANCING: "#c084fc",
  RECOVERING:  "#60a5fa",
};

// ── Page ─────────────────────────────────────────────────────────────────────
export default function Timeline() {
  const { history, replayMode, replayIndex, startReplay, stopReplay, recordSnapshot } =
    useCluster();


  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const playTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Filter to "significant" events only for display (every 10th snapshot + state changes)
  const significant = history.filter((snap, i) => {
    if (snap.label !== "periodic") return true;
    return i % 3 === 0; // show every 3rd periodic snapshot to avoid flooding
  });

  const currentIdx = replayIndex !== null
    ? significant.findIndex((s) => s === history[replayIndex])
    : -1;

  // Play / pause
  const togglePlay = useCallback(() => {
    if (playing) {
      if (playTimerRef.current) clearInterval(playTimerRef.current);
      setPlaying(false);
    } else {
      if (significant.length === 0) return;
      const startIdx = currentIdx < 0 || currentIdx >= significant.length - 1 ? 0 : currentIdx;
      startReplay(history.indexOf(significant[startIdx]));
      setPlaying(true);
    }
  }, [playing, currentIdx, significant, history, startReplay]);

  // Advance playback
  useEffect(() => {
    if (!playing) return;
    if (playTimerRef.current) clearInterval(playTimerRef.current);
    const interval = Math.max(300, 1000 / speed);
    playTimerRef.current = setInterval(() => {
      setReplayPos((pos) => {
        const next = pos + 1;
        if (next >= significant.length) {
          // End of history — stop
          setPlaying(false);
          clearInterval(playTimerRef.current!);
          return pos;
        }
        startReplay(history.indexOf(significant[next]));
        return next;
      });
    }, interval);
    return () => { if (playTimerRef.current) clearInterval(playTimerRef.current); };
  }, [playing, speed, significant, history, startReplay]);

  const [replayPos, setReplayPos] = useState(0);

  function jumpTo(sigIdx: number) {
    const snap = significant[sigIdx];
    if (!snap) return;
    setReplayPos(sigIdx);
    startReplay(history.indexOf(snap));
  }

  function handleStop() {
    if (playTimerRef.current) clearInterval(playTimerRef.current);
    setPlaying(false);
    stopReplay();
    setReplayPos(0);
  }

  // Current replay snapshot for display
  const currentSnap: ClusterSnapshot | null =
    replayMode && replayIndex !== null ? (history[replayIndex] ?? null) : null;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <SectionHeader
          title="Timeline Replay"
          subtitle={`Flight recorder — ${history.length} snapshots · ${significant.length} events${replayMode ? " · ⏵ REPLAYING" : ""}`}
        />
        {replayMode && (
          <span className="flex items-center gap-1.5 rounded-full border border-purple-700 bg-purple-950/40 px-3 py-1.5 text-xs font-bold text-purple-400 mt-1">
            <span className="h-2 w-2 rounded-full bg-purple-400" style={{ animation: "pulse 1s infinite" }} />
            REPLAY MODE
          </span>
        )}
      </div>

      {/* VCR Controls */}
      <div className="rounded-2xl border border-zinc-700 bg-zinc-900 p-5 space-y-4">
        <div className="flex items-center gap-3 justify-center">
          {/* ⏮ Reset */}
          <button
            onClick={() => jumpTo(0)}
            className="h-10 w-10 rounded-xl border border-zinc-700 bg-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-500 text-lg transition flex items-center justify-center"
            title="Jump to start"
          >⏮</button>
          {/* ◀ Prev */}
          <button
            onClick={() => { const ni = Math.max(0, replayPos - 1); jumpTo(ni); setReplayPos(ni); }}
            className="h-10 w-10 rounded-xl border border-zinc-700 bg-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-500 text-lg transition flex items-center justify-center"
            title="Previous event"
          >◀</button>
          {/* Play/Pause */}
          <button
            onClick={togglePlay}
            className={`h-12 w-12 rounded-xl border text-xl font-bold transition flex items-center justify-center ${
              playing
                ? "border-purple-700 bg-purple-950/40 text-purple-400 hover:bg-purple-900/40"
                : "border-blue-700 bg-blue-950/40 text-blue-400 hover:bg-blue-900/40"
            }`}
            title={playing ? "Pause" : "Play"}
          >
            {playing ? "⏸" : "▶"}
          </button>
          {/* ▶ Next */}
          <button
            onClick={() => { const ni = Math.min(significant.length - 1, replayPos + 1); jumpTo(ni); setReplayPos(ni); }}
            className="h-10 w-10 rounded-xl border border-zinc-700 bg-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-500 text-lg transition flex items-center justify-center"
            title="Next event"
          >▶</button>
          {/* ⏭ End */}
          <button
            onClick={() => jumpTo(significant.length - 1)}
            className="h-10 w-10 rounded-xl border border-zinc-700 bg-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-500 text-lg transition flex items-center justify-center"
            title="Jump to end"
          >⏭</button>
          {/* Stop */}
          <button
            onClick={handleStop}
            disabled={!replayMode}
            className="h-10 w-10 rounded-xl border border-zinc-700 bg-zinc-800 text-zinc-400 hover:text-red-400 hover:border-red-700 text-sm transition flex items-center justify-center disabled:opacity-30"
            title="Stop replay (return to live)"
          >■</button>

          {/* Speed */}
          <div className="flex gap-1 ml-4">
            {[0.5, 1, 2, 4].map((s) => (
              <button
                key={s}
                onClick={() => setSpeed(s)}
                className={`rounded-lg border px-2.5 py-1.5 text-xs font-bold transition ${
                  speed === s ? "border-blue-700 bg-blue-950/40 text-blue-400" : "border-zinc-700 text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {s}×
              </button>
            ))}
          </div>
        </div>

        {/* Scrubber */}
        <div className="space-y-1">
          <input
            type="range"
            min={0}
            max={Math.max(0, significant.length - 1)}
            value={replayPos}
            onChange={(e) => { const v = Number(e.target.value); jumpTo(v); setReplayPos(v); }}
            className="w-full accent-purple-500"
          />
          <div className="flex justify-between text-[10px] text-zinc-600">
            <span>{significant.length > 0 ? formatTime(significant[0].time) : "—"}</span>
            <span>{significant.length > 0 ? `${replayPos + 1} / ${significant.length}` : "No history"}</span>
            <span>{significant.length > 0 ? formatTime(significant[significant.length - 1].time) : "—"}</span>
          </div>
        </div>
      </div>

      {/* Current replay snapshot */}
      {replayMode && currentSnap && (
        <div className="rounded-2xl border border-purple-800 bg-purple-950/20 p-5 space-y-3">
          <div className="flex items-center gap-3">
            <span className="text-purple-400 text-xl">{labelIcon(currentSnap)}</span>
            <div>
              <p className="text-sm font-bold text-purple-300">{describeSnapshot(currentSnap)}</p>
              <p className="text-[11px] text-purple-500">{formatTime(currentSnap.time)} · snapshot {replayIndex}</p>
            </div>
          </div>
          {/* Node states at this snapshot */}
          <div className="flex flex-wrap gap-2">
            {currentSnap.nodes.map((n) => (
              <div
                key={n.id}
                className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5"
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: STATE_DOT[n.state] ?? "#94a3b8" }} />
                <span className="text-xs font-mono text-zinc-300">{n.name ?? `node${n.id}`}</span>
                <span className="text-[10px]" style={{ color: STATE_DOT[n.state] ?? "#94a3b8" }}>{n.state}</span>
              </div>
            ))}
            {currentSnap.partitions.length > 0 && (
              <div className="flex items-center gap-1.5 rounded-lg border border-orange-800 bg-orange-950/20 px-3 py-1.5">
                <span className="text-orange-400 text-xs font-bold">✂ {currentSnap.partitions.length} partition{currentSnap.partitions.length > 1 ? "s" : ""}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main layout: timeline list + event detail */}
      <div className="grid grid-cols-[280px_1fr] gap-6">
        {/* Timeline list */}
        <div className="rounded-2xl border border-zinc-700 bg-zinc-900 overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-800">
            <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
              {significant.length} Events Recorded
            </p>
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: 500 }}>
            {significant.length === 0 ? (
              <div className="px-4 py-8 text-center text-zinc-600 text-xs">
                No events recorded yet.<br />Perform chaos operations to populate the timeline.
              </div>
            ) : (
              <div className="relative">
                {/* Vertical line */}
                <div className="absolute left-7 top-0 bottom-0 w-px bg-zinc-800" />
                {significant.map((snap, i) => {
                  const color = labelColor(snap);
                  const isSelected = i === replayPos && replayMode;
                  return (
                    <button
                      key={i}
                      onClick={() => { jumpTo(i); setReplayPos(i); }}
                      className={`w-full flex items-start gap-3 px-4 py-3 text-left transition hover:bg-zinc-800/50 ${
                        isSelected ? "bg-purple-950/30 border-l-2 border-l-purple-500" : ""
                      }`}
                    >
                      {/* Event dot */}
                      <div className="relative z-10 mt-0.5 flex-shrink-0">
                        <div
                          className="h-3 w-3 rounded-full border-2"
                          style={{ borderColor: color, backgroundColor: color + "33" }}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-bold truncate" style={{ color }}>
                          {labelIcon(snap)} {describeSnapshot(snap)}
                        </p>
                        <p className="text-[10px] text-zinc-600">{formatTime(snap.time)}</p>
                      </div>
                      {isSelected && (
                        <span className="text-[9px] text-purple-400 font-bold shrink-0">▶ NOW</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Event detail panel */}
        <div className="rounded-2xl border border-zinc-700 bg-zinc-900 p-5 space-y-4">
          <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Cluster State at Selected Event</p>

          {significant.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-4xl mb-3">🕐</p>
              <p className="text-zinc-400 font-bold">No history yet</p>
              <p className="text-zinc-600 text-sm mt-1">
                The cluster auto-records snapshots every 5 seconds.<br />
                Perform chaos operations to create events.
              </p>
              <button
                onClick={() => recordSnapshot("manual-test")}
                className="mt-4 rounded-lg border border-blue-700 bg-blue-950/30 px-4 py-2 text-xs font-bold text-blue-400 hover:bg-blue-900/30 transition"
              >
                Record snapshot now
              </button>
            </div>
          ) : (
            (() => {
              const snap = replayMode && currentSnap ? currentSnap : significant[replayPos] ?? significant[significant.length - 1];
              if (!snap) return null;
              return (
                <div className="space-y-5">
                  {/* Summary */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-xl bg-zinc-800/50 p-3 text-center">
                      <p className="text-[10px] text-zinc-500 uppercase">Nodes</p>
                      <p className="text-xl font-bold text-white mt-1">{snap.nodes.length}</p>
                    </div>
                    <div className="rounded-xl bg-zinc-800/50 p-3 text-center">
                      <p className="text-[10px] text-zinc-500 uppercase">Down</p>
                      <p className={`text-xl font-bold mt-1 ${snap.nodes.filter(n => n.state === "UNREACHABLE").length > 0 ? "text-red-400" : "text-zinc-400"}`}>
                        {snap.nodes.filter(n => n.state === "UNREACHABLE").length}
                      </p>
                    </div>
                    <div className="rounded-xl bg-zinc-800/50 p-3 text-center">
                      <p className="text-[10px] text-zinc-500 uppercase">Partitions</p>
                      <p className={`text-xl font-bold mt-1 ${snap.partitions.length > 0 ? "text-orange-400" : "text-zinc-400"}`}>
                        {snap.partitions.length}
                      </p>
                    </div>
                  </div>

                  {/* Per-node state */}
                  <div className="space-y-2">
                    {snap.nodes.map((n) => (
                      <div key={n.id} className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-800/30 px-4 py-3">
                        <span
                          className="h-3 w-3 rounded-full shrink-0"
                          style={{ backgroundColor: STATE_DOT[n.state] ?? "#94a3b8" }}
                        />
                        <span className="text-sm font-mono font-bold text-zinc-200 w-16">{n.name ?? `node${n.id}`}</span>
                        <span className="text-xs font-bold" style={{ color: STATE_DOT[n.state] ?? "#94a3b8" }}>
                          {n.state}
                        </span>
                        {n.lagMs != null && n.lagMs > 0 && (
                          <span className="ml-auto text-[10px] text-zinc-600 font-mono">lag {n.lagMs.toFixed(1)}ms</span>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Partitions */}
                  {snap.partitions.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Active Partitions</p>
                      {snap.partitions.map((p, i) => (
                        <div key={i} className="flex items-center gap-2 rounded-lg border border-orange-800/40 bg-orange-950/10 px-3 py-2 text-xs">
                          <span className="text-orange-400 font-bold">node{p.from}</span>
                          <span className="text-zinc-600">✂ isolated from</span>
                          <span className="text-orange-400 font-bold">node{p.to}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()
          )}
        </div>
      </div>

      {/* Info banner */}
      {!replayMode && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 px-4 py-3 flex items-start gap-3">
          <span className="text-zinc-500 text-lg mt-0.5">💡</span>
          <p className="text-xs text-zinc-500">
            <span className="text-zinc-400 font-bold">Live mode.</span> The dashboard is showing real-time cluster state.
            Click any event in the timeline list or press ▶ to enter replay mode — all pages (Dashboard, Replication, Hash Ring, Metrics) will update to show the cluster state at that point in time.
          </p>
        </div>
      )}
    </div>
  );
}
