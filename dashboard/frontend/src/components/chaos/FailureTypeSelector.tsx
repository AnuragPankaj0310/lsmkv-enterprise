import { useState } from "react";
import type { FailureType } from "../../types/failure";
import { FAILURE_LABELS } from "../../types/failure";

const FAILURE_TYPES: { type: FailureType; icon: string; description: string }[] = [
  { type: "node_crash",         icon: "💥", description: "Process exits immediately" },
  { type: "heartbeat_timeout",  icon: "💔", description: "Missed heartbeats → SUSPECT" },
  { type: "disk_full",          icon: "💿", description: "Writes fail, reads continue" },
  { type: "high_cpu",           icon: "🔥", description: "CPU spikes → slow responses" },
  { type: "high_latency",       icon: "⏱", description: "All ops take 50–200 ms extra" },
  { type: "network_partition",  icon: "✂️", description: "Drop packets to peer nodes" },
  { type: "wal_corruption",     icon: "📄", description: "WAL CRC mismatch on replay" },
  { type: "sstable_corruption", icon: "🗄", description: "Block checksum failures" },
  { type: "readonly_disk",      icon: "🔒", description: "Disk mounted read-only" },
];

interface FailureTypeSelectorProps {
  selectedNode: number | null;
  onInject: (type: FailureType) => void;
}

export function FailureTypeSelector({ selectedNode, onInject }: FailureTypeSelectorProps) {
  const [selected, setSelected] = useState<FailureType | null>(null);
  const disabled = selectedNode === null || selected === null;

  return (
    <div className="rounded-xl bg-zinc-900 p-5 space-y-4">
      <p className="text-xs text-zinc-500 uppercase tracking-wider">
        💉 Inject Failure
        {selectedNode !== null && (
          <span className="ml-2 text-yellow-400">→ node{selectedNode}</span>
        )}
      </p>

      {/* Type grid */}
      <div className="grid grid-cols-3 gap-2">
        {FAILURE_TYPES.map(({ type, icon, description }) => {
          const isSelected = selected === type;
          return (
            <button
              key={type}
              onClick={() => setSelected(isSelected ? null : type)}
              title={description}
              className={`rounded-lg border px-3 py-2.5 text-left transition group ${
                isSelected
                  ? "border-red-700 bg-red-950/50 text-red-400"
                  : "border-zinc-700 bg-zinc-800/50 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
              }`}
            >
              <span className="text-base">{icon}</span>
              <p className="text-[10px] font-bold mt-1 leading-tight">{FAILURE_LABELS[type]}</p>
              <p className="text-[9px] text-zinc-600 mt-0.5 leading-tight group-hover:text-zinc-500 hidden sm:block">
                {description}
              </p>
            </button>
          );
        })}
      </div>

      {/* Inject button */}
      <button
        onClick={() => {
          if (disabled) return;
          onInject(selected!);
          setSelected(null);
        }}
        disabled={disabled}
        className="w-full rounded-lg border border-red-700 bg-red-950/40 py-2.5 text-sm font-bold text-red-400 transition hover:bg-red-900/50 disabled:opacity-30 disabled:cursor-not-allowed"
      >
        {selectedNode === null
          ? "Select a target node first"
          : selected === null
          ? "Select a failure type"
          : `Inject ${FAILURE_LABELS[selected]} → node${selectedNode}`}
      </button>
    </div>
  );
}
