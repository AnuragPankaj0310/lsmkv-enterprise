/**
 * ReadPathAnimator — step-by-step GET read path visualization.
 *
 * Type a key → click GET → watch it traverse Bloom filter → L0 miss → L1 miss → L2 FOUND
 * Each step animates in with 600ms stagger.
 */
import { useState, useCallback } from "react";

interface LevelData {
  level: number;
  count: number;
}

interface Props {
  levels: LevelData[];
  nodeHex: string;
}

type StepStatus = "pending" | "checking" | "miss" | "hit" | "bloom_miss" | "bloom_hit";

interface Step {
  id: string;
  label: string;
  sublabel?: string;
  status: StepStatus;
  latencyMs?: number;
}

function buildSteps(levels: LevelData[]): Step[] {
  const steps: Step[] = [
    { id: "bloom", label: "Bloom Filter", sublabel: "Check if key might exist", status: "pending" },
  ];
  for (let i = 0; i < Math.min(levels.length, 4); i++) {
    steps.push({
      id: `l${i}`,
      label: `Level ${i} (L${i})`,
      sublabel: `${levels[i]?.count ?? 0} SSTable${(levels[i]?.count ?? 0) !== 1 ? "s" : ""}`,
      status: "pending",
    });
  }
  return steps;
}

const STATUS_STYLE: Record<StepStatus, { border: string; bg: string; text: string; icon: string }> = {
  pending:    { border: "border-zinc-800", bg: "bg-zinc-900/30",    text: "text-zinc-600", icon: "○" },
  checking:   { border: "border-blue-700", bg: "bg-blue-950/30",    text: "text-blue-400", icon: "⟳" },
  miss:       { border: "border-red-800",  bg: "bg-red-950/20",     text: "text-red-400",  icon: "✗" },
  hit:        { border: "border-green-700",bg: "bg-green-950/20",   text: "text-green-400",icon: "✓" },
  bloom_miss: { border: "border-zinc-700", bg: "bg-zinc-900/40",    text: "text-zinc-500", icon: "⊘" },
  bloom_hit:  { border: "border-yellow-700",bg: "bg-yellow-950/20", text: "text-yellow-400",icon: "?" },
};

export default function ReadPathAnimator({ levels }: Props) {
  const [keyInput, setKeyInput] = useState("");
  const [steps, setSteps] = useState<Step[]>(() => buildSteps(levels));
  const [running, setRunning] = useState(false);
  const [foundAt, setFoundAt] = useState<string | null>(null);
  const [totalMs, setTotalMs] = useState<number | null>(null);

  const runAnimation = useCallback(() => {
    if (!keyInput.trim() || running) return;
    const _key = keyInput.trim();
    void _key;
    setRunning(true);
    setFoundAt(null);
    setTotalMs(null);
    const freshSteps = buildSteps(levels);
    setSteps(freshSteps);

    // Decide where to "find" the key — randomly pick a level or not find it
    const hitLevel = Math.floor(Math.random() * Math.min(levels.length, 4));
    const _bloomHit = true; // always passes bloom (makes animation more interesting)
    void _bloomHit;
    let accumulated = 0;

    // Step 0: Bloom filter
    setTimeout(() => {
      setSteps((prev) => prev.map((s, i) => i === 0 ? { ...s, status: "checking" } : s));
    }, 400);
    setTimeout(() => {
      const lat = Math.floor(Math.random() * 2 + 1);
      accumulated += lat;
      setSteps((prev) => prev.map((s, i) => i === 0 ? { ...s, status: "bloom_hit", latencyMs: lat } : s));
    }, 1000);

    // Steps 1…: Level scans
    freshSteps.slice(1).forEach((_, idx) => {
      const delay = 1400 + idx * 800;
      const checkDelay = delay;
      const resolveDelay = delay + 500;

      setTimeout(() => {
        setSteps((prev) => prev.map((s, i) => i === idx + 1 ? { ...s, status: "checking" } : s));
      }, checkDelay);

      setTimeout(() => {
        const isHit = idx === hitLevel;
        const lat = Math.floor(Math.random() * 8 + 2) * (idx + 1);
        accumulated += lat;
        setSteps((prev) => prev.map((s, i) =>
          i === idx + 1 ? { ...s, status: isHit ? "hit" : "miss", latencyMs: lat } : s
        ));
        if (isHit) {
          setFoundAt(`L${idx}`);
          setTotalMs(accumulated);
          setRunning(false);
        }
        if (idx === Math.min(levels.length, 4) - 1 && !isHit) {
          setFoundAt("NOT_FOUND");
          setTotalMs(accumulated);
          setRunning(false);
        }
      }, resolveDelay);
    });
  }, [keyInput, running, levels]);

  return (
    <div className="space-y-4">
      <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider">📖 Read Path — GET Trace</p>
      <p className="text-[10px] text-zinc-600">Simulate a key lookup through the LSM levels</p>

      <div className="flex gap-2">
        <input
          value={keyInput}
          onChange={(e) => setKeyInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && runAnimation()}
          placeholder="e.g. user:42"
          disabled={running}
          className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-blue-600 focus:outline-none disabled:opacity-50"
        />
        <button
          onClick={runAnimation}
          disabled={running || !keyInput.trim()}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-500 transition disabled:opacity-50"
        >
          {running ? "⟳ Running…" : "GET"}
        </button>
        <button
          onClick={() => {
            setSteps(buildSteps(levels));
            setFoundAt(null);
            setTotalMs(null);
            setRunning(false);
          }}
          className="rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-500 hover:border-zinc-500 transition"
        >
          Reset
        </button>
      </div>

      {/* Steps */}
      <div className="space-y-2">
        {steps.map((step) => {
          const s = STATUS_STYLE[step.status];
          return (
            <div
              key={step.id}
              className={`rounded-xl border px-4 py-3 flex items-center gap-3 transition-all duration-500 ${s.border} ${s.bg}`}
            >
              <span
                className={`text-lg font-bold ${s.text} ${step.status === "checking" ? "animate-spin" : ""}`}
                style={{ animationDuration: "1s" }}
              >
                {s.icon}
              </span>
              <div className="flex-1">
                <p className={`text-sm font-bold ${s.text}`}>{step.label}</p>
                {step.sublabel && <p className="text-[10px] text-zinc-600">{step.sublabel}</p>}
              </div>
              {step.latencyMs !== undefined && (
                <span className={`text-xs font-mono ${s.text}`}>+{step.latencyMs}ms</span>
              )}
              <span className={`text-xs font-bold uppercase ${s.text}`}>
                {step.status === "pending" && "—"}
                {step.status === "checking" && "CHECKING"}
                {step.status === "miss" && "MISS"}
                {step.status === "hit" && "FOUND ✓"}
                {step.status === "bloom_hit" && "MIGHT EXIST"}
                {step.status === "bloom_miss" && "SKIP"}
              </span>
            </div>
          );
        })}
      </div>

      {/* Final result */}
      {foundAt && (
        <div className={`rounded-xl border px-4 py-3 text-center font-bold text-sm ${
          foundAt === "NOT_FOUND"
            ? "border-zinc-700 bg-zinc-900 text-zinc-400"
            : "border-green-700 bg-green-950/20 text-green-400"
        }`}>
          {foundAt === "NOT_FOUND"
            ? `✗ Key "${keyInput}" not found in any level`
            : `✓ Key "${keyInput}" found at ${foundAt} — ${totalMs}ms total`}
        </div>
      )}
    </div>
  );
}
