/**
 * ProgressPanel — shows rebalancing progress, keys/sec, and ETA.
 * Extracted from Rebalancing.tsx to comply with component structure.
 */
interface ProgressPanelProps {
  progress: number;          // 0–100
  keysMoved: number;
  totalKeys: number;
  keysPerSec: number;
  etaSeconds: number;
  running: boolean;
  onStart: () => void;
  onStop: () => void;
}

export function ProgressPanel({
  progress, keysMoved, totalKeys, keysPerSec, etaSeconds, running, onStart, onStop,
}: ProgressPanelProps) {
  const etaStr = etaSeconds <= 0 ? "—" : etaSeconds < 60
    ? `${etaSeconds}s`
    : `${Math.floor(etaSeconds / 60)}m ${etaSeconds % 60}s`;

  return (
    <div className="rounded-xl bg-zinc-900 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-500 uppercase tracking-wider">⚖️ Rebalancing Progress</p>
        <div className="flex gap-2">
          <button
            onClick={running ? onStop : onStart}
            className={`rounded-lg border px-4 py-1.5 text-xs font-bold transition ${
              running
                ? "border-red-700 bg-red-950/40 text-red-400 hover:bg-red-900/40"
                : "border-green-700 bg-green-950/40 text-green-400 hover:bg-green-900/40"
            }`}
          >
            {running ? "⏹ Stop" : "▶ Start Rebalance"}
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div>
        <div className="flex justify-between text-xs mb-1.5">
          <span className="text-zinc-500">{keysMoved.toLocaleString()} / {totalKeys.toLocaleString()} keys moved</span>
          <span className="font-bold text-zinc-200">{progress.toFixed(1)}%</span>
        </div>
        <div className="h-3 rounded-full bg-zinc-800 overflow-hidden">
          <div
            className="h-3 rounded-full transition-all duration-500"
            style={{
              width: `${progress}%`,
              background: "linear-gradient(90deg, #6366f1, #a855f7, #ec4899)",
            }}
          />
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3 text-center text-xs">
        <div className="rounded-lg bg-zinc-800 p-3">
          <p className="text-zinc-500">Keys/sec</p>
          <p className="font-mono font-bold text-white mt-1">{running ? keysPerSec : "—"}</p>
        </div>
        <div className="rounded-lg bg-zinc-800 p-3">
          <p className="text-zinc-500">ETA</p>
          <p className="font-mono font-bold text-white mt-1">{running ? etaStr : "—"}</p>
        </div>
        <div className="rounded-lg bg-zinc-800 p-3">
          <p className="text-zinc-500">Status</p>
          <p className={`font-bold mt-1 ${running ? "text-purple-400" : progress >= 100 ? "text-green-400" : "text-zinc-500"}`}>
            {running ? "ACTIVE" : progress >= 100 ? "COMPLETE" : "IDLE"}
          </p>
        </div>
      </div>
    </div>
  );
}
