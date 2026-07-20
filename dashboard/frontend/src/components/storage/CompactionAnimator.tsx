import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface Block {
  id: number;
  level: number;    // 0, 1, or 2
  slot: number;     // horizontal position
  merging?: boolean;
}

interface CompactionAnimatorProps {
  nodeColor: string;
  nodeHex: string;
}

let _blockId = 0;

// Level capacities for display
const LEVEL_CAPS = [4, 3, 2];  // L0, L1, L2 max blocks shown

export function CompactionAnimator({ nodeColor: _nodeColor, nodeHex }: CompactionAnimatorProps) {
  const [running, setRunning] = useState(false);
  const [blocks, setBlocks] = useState<Block[]>(() => [
    // Start with some blocks at L0
    { id: _blockId++, level: 0, slot: 0 },
    { id: _blockId++, level: 0, slot: 1 },
    { id: _blockId++, level: 0, slot: 2 },
    // Some at L1
    { id: _blockId++, level: 1, slot: 0 },
    { id: _blockId++, level: 1, slot: 1 },
    // One at L2
    { id: _blockId++, level: 2, slot: 0 },
  ]);
  const [phase, setPhase] = useState<"idle" | "merging" | "flushing" | "done">("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearTimer() {
    if (timerRef.current) clearTimeout(timerRef.current);
  }

  function startCompaction() {
    setRunning(true);
    setPhase("merging");

    // Phase 1 — mark L0 blocks as merging
    setBlocks((prev) => prev.map((b) => (b.level === 0 ? { ...b, merging: true } : b)));

    // Phase 2 — remove L0 blocks, add merged L1 block
    timerRef.current = setTimeout(() => {
      setPhase("flushing");
      setBlocks((prev) => {
        const without0 = prev.filter((b) => b.level !== 0);
        const newL1: Block = { id: _blockId++, level: 1, slot: without0.filter((b) => b.level === 1).length };
        return [...without0, newL1];
      });

      // Phase 3 — compact L1 → L2
      timerRef.current = setTimeout(() => {
        setBlocks((prev) => {
          const l1 = prev.filter((b) => b.level === 1);
          if (l1.length < 2) return prev;
          const withoutL1 = prev.filter((b) => b.level !== 1);
          const newL2: Block = { id: _blockId++, level: 2, slot: withoutL1.filter((b) => b.level === 2).length };
          // Keep one L1 block
          const keepOne = l1.slice(0, 1).map((b) => ({ ...b, merging: false }));
          return [...withoutL1, ...keepOne, newL2];
        });

        // Phase 4 — repopulate L0 (write buffer)
        timerRef.current = setTimeout(() => {
          setBlocks((prev) => [
            ...prev,
            { id: _blockId++, level: 0, slot: 0 },
            { id: _blockId++, level: 0, slot: 1 },
          ]);
          setPhase("done");
          setRunning(false);
        }, 1200);
      }, 1200);
    }, 1200);
  }

  useEffect(() => () => clearTimer(), []);

  // Level row config
  const levels = [0, 1, 2];
  const LEVEL_LABELS = ["L0 — MemTable Flush", "L1 — Minor Compaction", "L2 — Major Compaction"];
  const LEVEL_HEIGHT = 48;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Compaction</p>
        <button
          onClick={startCompaction}
          disabled={running}
          className={`rounded-lg border px-3 py-1 text-[10px] font-bold transition ${
            running
              ? "border-zinc-700 text-zinc-600 cursor-not-allowed"
              : "border-purple-700 bg-purple-950/40 text-purple-400 hover:bg-purple-900/40"
          }`}
        >
          {running ? `${phase === "merging" ? "Merging…" : phase === "flushing" ? "Flushing…" : "Done"}` : "▶ Run Compaction"}
        </button>
      </div>

      {/* Level rows */}
      <div className="space-y-1.5 font-mono">
        {levels.map((lvl) => {
          const lvlBlocks = blocks.filter((b) => b.level === lvl);
          return (
            <div key={lvl} className="space-y-1">
              <p className="text-[9px] text-zinc-600 uppercase">{LEVEL_LABELS[lvl]}</p>
              <div className="flex items-center gap-1" style={{ minHeight: LEVEL_HEIGHT / 2 }}>
                {/* Empty slots */}
                {Array.from({ length: LEVEL_CAPS[lvl] }, (_, slot) => {
                  const block = lvlBlocks.find((b) => b.slot === slot);
                  return (
                    <div key={slot} className="relative h-7 w-10">
                      {/* Background slot */}
                      <div className="absolute inset-0 rounded border border-zinc-800 bg-zinc-900/40" />
                      <AnimatePresence>
                        {block && (
                          <motion.div
                            key={block.id}
                            layoutId={`block-${block.id}`}
                            initial={{ opacity: 0, scale: 0.7, y: lvl === 0 ? -10 : 10 }}
                            animate={{
                              opacity: block.merging ? [1, 0.3, 1, 0.3, 0] : 1,
                              scale: block.merging ? [1, 0.95, 1, 0.95, 0.8] : 1,
                              y: 0,
                            }}
                            exit={{ opacity: 0, scale: 0.5, y: 8 }}
                            transition={{ duration: block.merging ? 1.0 : 0.35, ease: "easeInOut" }}
                            className="absolute inset-0.5 rounded flex items-center justify-center text-[8px] font-bold"
                            style={{ backgroundColor: nodeHex + "25", borderColor: nodeHex + "60", border: `1px solid ${nodeHex}60`, color: nodeHex }}
                          >
                            ■
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}

                {/* Merge arrow between levels */}
                {lvl < 2 && (
                  <motion.span
                    animate={{ opacity: running && phase === (lvl === 0 ? "merging" : "flushing") ? [0.3, 1, 0.3] : 0.2 }}
                    transition={{ repeat: Infinity, duration: 0.6 }}
                    className="text-zinc-600 text-sm ml-1"
                  >↓</motion.span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
