/**
 * BloomFilterViz — interactive Bloom filter bit-array visualizer.
 *
 * Shows a 32-bit grid. User can type a key → watch 3 hash functions
 * light up bits in sequence. Separate demo for SET vs LOOKUP.
 */
import { useState } from "react";

const BITS = 32;

function hashN(key: string, seed: number): number {
  let h = seed * 2654435761;
  for (let i = 0; i < key.length; i++) {
    h = Math.imul(h ^ key.charCodeAt(i), 0x9e3779b9);
  }
  return ((h >>> 0) % BITS + BITS) % BITS;
}

function getHashes(key: string): number[] {
  return [hashN(key, 1), hashN(key, 37), hashN(key, 101)];
}

const HASH_COLORS = ["#60a5fa", "#4ade80", "#f472b6"];

interface AnimStep {
  hashIdx: number;
  bit: number;
}

export default function BloomFilterViz() {
  const [bits, setBits] = useState<boolean[]>(Array(BITS).fill(false));
  const [keyInput, setKeyInput] = useState("");
  const [activeHashes, setActiveHashes] = useState<{ bit: number; color: string }[]>([]);
  const [animStep, setAnimStep] = useState<AnimStep | null>(null);
  const [mode, setMode] = useState<"SET" | "LOOKUP">("SET");
  const [result, setResult] = useState<"HIT" | "MISS" | "FALSE_POSITIVE" | null>(null);
  const [insertedKeys, setInsertedKeys] = useState<string[]>([]);

  function handleSet() {
    if (!keyInput.trim()) return;
    const key = keyInput.trim();
    const hashes = getHashes(key);

    // Animate each hash in sequence
    setActiveHashes([]);
    setResult(null);
    hashes.forEach((bit, i) => {
      setTimeout(() => {
        setAnimStep({ hashIdx: i, bit });
        setActiveHashes((prev) => [...prev, { bit, color: HASH_COLORS[i] }]);
      }, i * 500);
    });

    setTimeout(() => {
      setBits((prev) => {
        const next = [...prev];
        hashes.forEach((b) => (next[b] = true));
        return next;
      });
      setInsertedKeys((prev) => [...prev, key]);
      setAnimStep(null);
      setResult(null);
    }, hashes.length * 500 + 400);

    setKeyInput("");
  }

  function handleLookup() {
    if (!keyInput.trim()) return;
    const key = keyInput.trim();
    const hashes = getHashes(key);

    setActiveHashes([]);
    setResult(null);

    hashes.forEach((bit, i) => {
      setTimeout(() => {
        setAnimStep({ hashIdx: i, bit });
        setActiveHashes((prev) => [...prev, { bit, color: HASH_COLORS[i] }]);
      }, i * 500);
    });

    setTimeout(() => {
      const allSet = hashes.every((b) => bits[b]);
      const actuallyInserted = insertedKeys.includes(key);
      if (!allSet) setResult("MISS");
      else if (actuallyInserted) setResult("HIT");
      else setResult("FALSE_POSITIVE");
      setAnimStep(null);
    }, hashes.length * 500 + 400);

    setKeyInput("");
  }

  function handleReset() {
    setBits(Array(BITS).fill(false));
    setActiveHashes([]);
    setResult(null);
    setInsertedKeys([]);
    setAnimStep(null);
  }

  const _activeBitSet = new Set(activeHashes.map((h) => h.bit));
  void _activeBitSet;


  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider">🔍 Bloom Filter</p>
        <div className="flex gap-1">
          <button
            onClick={() => { setMode("SET"); setResult(null); }}
            className={`rounded-lg px-3 py-1 text-xs font-bold transition ${mode === "SET" ? "bg-blue-600 text-white" : "border border-zinc-700 text-zinc-500"}`}
          >SET</button>
          <button
            onClick={() => { setMode("LOOKUP"); setResult(null); }}
            className={`rounded-lg px-3 py-1 text-xs font-bold transition ${mode === "LOOKUP" ? "bg-green-700 text-white" : "border border-zinc-700 text-zinc-500"}`}
          >LOOKUP</button>
          <button onClick={handleReset} className="rounded-lg border border-zinc-700 px-3 py-1 text-xs text-zinc-500 hover:text-red-400 hover:border-red-700 transition">
            Reset
          </button>
        </div>
      </div>

      {/* Bit array */}
      <div className="rounded-xl bg-zinc-950 border border-zinc-800 p-4">
        <p className="text-[10px] text-zinc-600 mb-3">32-bit filter — {bits.filter(Boolean).length} bits set</p>
        <div className="flex flex-wrap gap-1">
          {bits.map((set, i) => {
            const activeHash = activeHashes.find((h) => h.bit === i);
            const isAnimating = animStep?.bit === i;
            return (
              <div
                key={i}
                title={`Bit ${i}`}
                className="w-6 h-6 rounded flex items-center justify-center text-[9px] font-mono transition-all duration-300"
                style={{
                  backgroundColor: activeHash
                    ? activeHash.color + "33"
                    : set
                    ? "#3f3f46"
                    : "#18181b",
                  border: `1px solid ${activeHash ? activeHash.color : set ? "#52525b" : "#27272a"}`,
                  color: activeHash ? activeHash.color : set ? "#a1a1aa" : "#3f3f46",
                  transform: isAnimating ? "scale(1.4)" : "scale(1)",
                  boxShadow: activeHash ? `0 0 6px ${activeHash.color}88` : undefined,
                }}
              >
                {set ? "1" : "0"}
              </div>
            );
          })}
        </div>
      </div>

      {/* Hash function legend */}
      {activeHashes.length > 0 && (
        <div className="flex gap-3 text-xs">
          {activeHashes.map((h, i) => (
            <span key={i} className="font-mono font-bold" style={{ color: h.color }}>
              h{i + 1}({keyInput || "…"}) = {h.bit}
            </span>
          ))}
        </div>
      )}

      {/* Input + action */}
      <div className="flex gap-2">
        <input
          value={keyInput}
          onChange={(e) => setKeyInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (mode === "SET" ? handleSet() : handleLookup())}
          placeholder={mode === "SET" ? "Key to insert…" : "Key to lookup…"}
          className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-blue-600 focus:outline-none"
        />
        <button
          onClick={mode === "SET" ? handleSet : handleLookup}
          disabled={!keyInput.trim()}
          className={`rounded-lg px-4 py-2 text-sm font-bold transition disabled:opacity-40 ${
            mode === "SET"
              ? "bg-blue-600 text-white hover:bg-blue-500"
              : "bg-green-700 text-white hover:bg-green-600"
          }`}
        >
          {mode === "SET" ? "SET" : "LOOKUP"}
        </button>
      </div>

      {/* Result */}
      {result && (
        <div className={`rounded-xl border px-4 py-3 text-sm font-bold text-center animate-pulse ${
          result === "HIT" ? "border-green-700 bg-green-950/30 text-green-400"
          : result === "MISS" ? "border-red-700 bg-red-950/30 text-red-400"
          : "border-yellow-700 bg-yellow-950/30 text-yellow-400"
        }`}>
          {result === "HIT" && "✓ TRUE POSITIVE — key found in filter AND in data"}
          {result === "MISS" && "✗ DEFINITE MISS — key not in this SSTable (skip I/O)"}
          {result === "FALSE_POSITIVE" && "⚠ FALSE POSITIVE — filter says YES, but key not in data (unnecessary I/O)"}
        </div>
      )}

      {/* Inserted keys */}
      {insertedKeys.length > 0 && (
        <div className="text-[10px] text-zinc-600">
          Inserted: {insertedKeys.map((k, i) => (
            <span key={i} className="text-zinc-500 font-mono mr-2">{k}</span>
          ))}
        </div>
      )}
    </div>
  );
}
