import { useEffect, useRef, useState } from "react";

interface BouncingPacket {
  id: number;
  fromNode: number;
  toNode: number;
  progress: number;   // 0..1 — bounces back at 0.5
  bounced: boolean;
  alive: boolean;
}

const W = 400, H = 300;
const NODE_HEX = ["#60a5fa", "#4ade80", "#facc15", "#c084fc", "#f472b6", "#2dd4bf"];

interface NetworkPartitionViewProps {
  partitions: { from: number; to: number }[];
  nodeCount?: number;
}

export function NetworkPartitionView({ partitions, nodeCount = 3 }: NetworkPartitionViewProps) {
  const [packets, setPackets] = useState<BouncingPacket[]>([]);
  const nextId = useRef(0);

  // Safe position getter — always clamps i to valid range
  const getPos = (i: number) => {
    const safeI = Math.max(0, Math.min(i, nodeCount - 1));
    const safeCount = Math.max(1, nodeCount);
    if (safeCount === 1) return { x: W / 2, y: H / 2 };
    const angle = -Math.PI / 2 + (Math.PI * 2 * safeI) / safeCount;
    return {
      x: W / 2 + Math.cos(angle) * 110,
      y: H / 2 + Math.sin(angle) * 110,
    };
  };

  // Partition midpoint: where the X appears
  function midpoint(a: number, b: number) {
    const posA = getPos(a);
    const posB = getPos(b);
    return { x: (posA.x + posB.x) / 2, y: (posA.y + posB.y) / 2 };
  }

  // Check if a pair is partitioned (bidirectional)
  function isPartitioned(a: number, b: number) {
    return partitions.some(
      (p) => (p.from === a && p.to === b) || (p.from === b && p.to === a)
    );
  }

  // Clear all packets when nodeCount changes to avoid stale indices
  useEffect(() => {
    setPackets([]);
  }, [nodeCount]);

  // Spawn bouncing packets for each partition pair
  useEffect(() => {
    if (partitions.length === 0) {
      setPackets([]);
      return;
    }

    const spawnId = setInterval(() => {
      partitions.forEach(({ from, to }) => {
        // Guard: only spawn packets for valid node indices
        if (from >= nodeCount || to >= nodeCount) return;
        const id = nextId.current++;
        setPackets((prev) => [
          ...prev.slice(-30),
          { id, fromNode: from, toNode: to, progress: 0, bounced: false, alive: true },
        ]);
      });
    }, 1200);

    const animId = setInterval(() => {
      setPackets((prev) =>
        prev
          .map((p) => {
            if (!p.alive) return p;
            let nextProg = p.progress + 0.02;
            let bounced = p.bounced;
            if (nextProg >= 0.5 && !bounced) {
              bounced = true;
            }
            if (nextProg >= 1.0) {
              return { ...p, alive: false };
            }
            return { ...p, progress: nextProg, bounced };
          })
          .filter((p) => p.alive)
      );
    }, 32);

    return () => {
      clearInterval(spawnId);
      clearInterval(animId);
    };
  }, [partitions, nodeCount]);

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="overflow-visible mt-4">
      {/* Background links */}
      {Array.from({ length: nodeCount }).flatMap((_, a) =>
        Array.from({ length: nodeCount })
          .map((_, b) => b)
          .filter((b) => b > a)
          .map((b) => {
            const isPart = isPartitioned(a, b);
            const pA = getPos(a);
            const pB = getPos(b);
            return (
              <line
                key={`link-${a}-${b}`}
                x1={pA.x} y1={pA.y}
                x2={pB.x} y2={pB.y}
                stroke={isPart ? "#7f1d1d" : "#27272a"}
                strokeWidth={isPart ? 2 : 1}
                strokeDasharray={isPart ? "6 4" : "none"}
              />
            );
          })
      )}

      {/* X markers at partition midpoints */}
      {partitions.map(({ from, to }) => {
        // Guard: skip if node indices are out of range
        if (from >= nodeCount || to >= nodeCount) return null;
        const m = midpoint(from, to);
        return (
          <g key={`x-${from}-${to}`}>
            <circle cx={m.x} cy={m.y} r={14} fill="#450a0a" stroke="#991b1b" strokeWidth={1.5} />
            <text x={m.x} y={m.y + 1} textAnchor="middle" dominantBaseline="middle"
              fill="#f87171" fontSize={13} fontWeight="bold">✕</text>
          </g>
        );
      })}

      {/* Animated bouncing packets */}
      {packets.map((pkt) => {
        // Guard: skip packets with out-of-range node IDs
        if (pkt.fromNode >= nodeCount || pkt.toNode >= nodeCount) return null;

        const fromPos = getPos(pkt.fromNode);
        const toPos = getPos(pkt.toNode);
        let t = pkt.progress;
        const returning = pkt.bounced;
        const actualT = returning ? 1 - (t - 0.5) * 2 : t * 2;
        const px = fromPos.x + (toPos.x - fromPos.x) * Math.min(actualT, 0.45);
        const py = fromPos.y + (toPos.y - fromPos.y) * Math.min(actualT, 0.45);

        const alpha = returning
          ? 1 - (t - 0.5) * 2
          : 1 - Math.max(t - 0.4, 0) * 5;

        return (
          <circle key={pkt.id}
            cx={px} cy={py} r={5}
            fill={NODE_HEX[pkt.fromNode] ?? "#a1a1aa"}
            opacity={Math.max(alpha, 0)}
          />
        );
      })}

      {/* Node circles */}
      {Array.from({ length: nodeCount }, (_, i) => {
        const p = getPos(i);
        const color = NODE_HEX[i] ?? "#a1a1aa";
        return (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={28}
              fill="#18181b" stroke={color} strokeWidth={2.5} />
            <text x={p.x} y={p.y + 1} textAnchor="middle" dominantBaseline="middle"
              fill={color} fontSize={10} fontWeight="bold">
              node{i}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
