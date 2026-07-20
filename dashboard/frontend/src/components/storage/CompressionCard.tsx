/**
 * CompressionCard — Before/After compression visualization.
 * Shows raw → Snappy → compressed with animated shrink bar and savings %.
 */
import { useState } from "react";

interface Props {
  totalDiskMb: number;
  nodeHex: string;
}

export default function CompressionCard({ totalDiskMb, nodeHex }: Props) {
  const [animated, setAnimated] = useState(false);
  const ratio = 0.42; // Snappy ~42% compressed
  const rawMb = totalDiskMb * (1 / ratio);
  const savedPct = Math.round((1 - ratio) * 100);

  return (
    <div className="space-y-4">
      <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider">🗜 Compression</p>

      <div className="space-y-3">
        {/* Before */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs">
            <span className="text-zinc-500">Raw (uncompressed)</span>
            <span className="font-mono text-zinc-300">{rawMb.toFixed(1)} MB</span>
          </div>
          <div className="h-4 rounded-full bg-zinc-800">
            <div
              className="h-4 rounded-full transition-all duration-1000"
              style={{ width: "100%", backgroundColor: "#52525b" }}
            />
          </div>
        </div>

        {/* Arrow */}
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <div className="h-px flex-1 bg-zinc-800" />
          <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 font-bold">
            Snappy
          </span>
          <div className="h-px flex-1 bg-zinc-800" />
        </div>

        {/* After */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs">
            <span className="text-zinc-500">Compressed</span>
            <span className="font-mono font-bold" style={{ color: nodeHex }}>{totalDiskMb.toFixed(1)} MB</span>
          </div>
          <div className="h-4 rounded-full bg-zinc-800 overflow-hidden">
            <div
              className="h-4 rounded-full transition-all duration-1000"
              style={{
                width: animated ? `${ratio * 100}%` : "100%",
                backgroundColor: nodeHex,
                transition: "width 1.2s cubic-bezier(0.22, 1, 0.36, 1)",
              }}
            />
          </div>
        </div>
      </div>

      {/* Savings badge */}
      <div
        className="rounded-xl border px-4 py-3 text-center cursor-pointer hover:brightness-110 transition"
        style={{ borderColor: nodeHex + "44", backgroundColor: nodeHex + "11" }}
        onClick={() => setAnimated((a) => !a)}
      >
        <p className="text-2xl font-bold" style={{ color: nodeHex }}>
          {savedPct}% saved
        </p>
        <p className="text-[10px] text-zinc-500 mt-1">
          {rawMb.toFixed(1)} MB → {totalDiskMb.toFixed(1)} MB · click to animate
        </p>
      </div>

      {/* Compression breakdown */}
      <div className="grid grid-cols-3 gap-2 text-[10px] text-center">
        {[
          { label: "Algorithm", value: "Snappy" },
          { label: "Block size", value: "4 KB" },
          { label: "Ratio", value: `${ratio.toFixed(2)}×` },
        ].map((s) => (
          <div key={s.label} className="rounded-lg bg-zinc-900/60 border border-zinc-800 py-2">
            <p className="text-zinc-600">{s.label}</p>
            <p className="text-zinc-300 font-mono font-bold mt-0.5">{s.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
