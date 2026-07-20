/**
 * BackgroundTasksWidget — Persistent top-right fixed overlay.
 *
 * Always visible. Never unmounts.
 *
 * Idle:   [⚙ No Active Tasks]
 * Active: [⚙ 1 task ▼] → dropdown with progress bars + history
 *
 * Completed ops shown for 30 seconds (purged by operationsStore).
 */
import { useState, useEffect } from "react";
import { useOperations } from "../store/operationsStore";
import type { Operation } from "../store/operationsStore";

// ── Progress bar ───────────────────────────────────────────────────────────────
function ProgressBar({ pct, color = "#60a5fa" }: { pct: number; color?: string }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-700"
        style={{ width: `${pct}%`, backgroundColor: color }}
      />
    </div>
  );
}

// ── ETA helper ────────────────────────────────────────────────────────────────
function etaLabel(op: Operation): string {
  if (op.status !== "running" || op.progress <= 0) return "";
  const elapsed = (Date.now() - op.startedAt) / 1000;
  if (elapsed < 0.5) return "";
  const totalEst = elapsed / (op.progress / 100);
  const remaining = Math.max(0, totalEst - elapsed);
  if (remaining < 2) return "< 2s";
  return `~${Math.round(remaining)}s`;
}

// ── Op row ────────────────────────────────────────────────────────────────────
function OpRow({ op }: { op: Operation }) {
  const isRunning = op.status === "running";
  const isFailed  = op.status === "failed";
  const eta = etaLabel(op);

  const dotColor = isRunning ? "#60a5fa" : isFailed ? "#f87171" : "#4ade80";
  const barColor = isRunning ? "#60a5fa" : isFailed ? "#f87171" : "#4ade80";
  const icon     = isRunning ? "⟳" : isFailed ? "✗" : "✓";

  return (
    <div className="px-3 py-2 space-y-1">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className="text-[11px] font-bold"
            style={{
              color: dotColor,
              animation: isRunning ? "spin 1.2s linear infinite" : "none",
              display: "inline-block",
            }}
          >
            {icon}
          </span>
          <span className="text-[11px] font-bold text-zinc-200 truncate">{op.name}</span>
        </div>
        <span className="text-[10px] font-mono shrink-0" style={{ color: dotColor }}>
          {isRunning ? `${op.progress}%` : isFailed ? "Failed" : "Completed"}
        </span>
      </div>

      {isRunning && (
        <>
          <ProgressBar pct={op.progress} color={barColor} />
          {eta && (
            <p className="text-[9px] text-zinc-600 text-right">{eta} remaining</p>
          )}
        </>
      )}

      {op.status === "completed" && op.result && (
        <p className="text-[9px] text-zinc-500 truncate">{op.result}</p>
      )}

      {isFailed && op.error && (
        <p className="text-[9px] text-red-500 truncate">{op.error}</p>
      )}
    </div>
  );
}

// ── Widget ────────────────────────────────────────────────────────────────────
export default function BackgroundTasksWidget() {
  const ops = useOperations();
  const [open, setOpen] = useState(false);

  const runningOps   = ops.filter(o => o.status === "running");
  const finishedOps  = ops.filter(o => o.status !== "running");
  const hasAny       = ops.length > 0;
  const runningCount = runningOps.length;

  // Auto-open when something starts running
  useEffect(() => {
    if (runningCount > 0) setOpen(true);
  }, [runningCount]);

  // Auto-close when nothing left after a delay
  useEffect(() => {
    if (runningCount === 0 && ops.length === 0) {
      const t = setTimeout(() => setOpen(false), 500);
      return () => clearTimeout(t);
    }
  }, [runningCount, ops.length]);

  const headerLabel = runningCount > 0
    ? `${runningCount} task${runningCount > 1 ? "s" : ""} running`
    : hasAny
    ? "Recent tasks"
    : "No active tasks";

  const headerColor = runningCount > 0
    ? "text-blue-400 border-blue-800 bg-blue-950/40"
    : hasAny
    ? "text-green-400 border-green-800 bg-green-950/30"
    : "text-zinc-600 border-zinc-800 bg-zinc-900/60";

  return (
    <div className="fixed top-4 right-4 z-50 w-64">
      {/* Header button */}
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-[11px] font-bold transition-all duration-200 backdrop-blur-sm ${headerColor}`}
      >
        <div className="flex items-center gap-2">
          <span
            className="text-[13px]"
            style={{ animation: runningCount > 0 ? "spin 2s linear infinite" : "none", display: "inline-block" }}
          >
            ⚙
          </span>
          <span>{headerLabel}</span>
        </div>
        {hasAny && (
          <span className="text-[9px] opacity-60">{open ? "▲" : "▼"}</span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && hasAny && (
        <div className="mt-1 rounded-xl border border-zinc-700 bg-zinc-950/95 backdrop-blur-sm shadow-xl overflow-hidden">
          {/* Running ops first */}
          {runningOps.length > 0 && (
            <div className="divide-y divide-zinc-800/60">
              {runningOps.map(op => <OpRow key={op.id} op={op} />)}
            </div>
          )}

          {/* Divider */}
          {runningOps.length > 0 && finishedOps.length > 0 && (
            <div className="border-t border-zinc-800 mx-3 my-0.5" />
          )}

          {/* Finished ops */}
          {finishedOps.length > 0 && (
            <div className="divide-y divide-zinc-800/40">
              {finishedOps.map(op => <OpRow key={op.id} op={op} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
