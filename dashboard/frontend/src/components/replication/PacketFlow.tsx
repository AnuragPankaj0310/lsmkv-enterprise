import { useEffect, useRef, useState } from "react";
import { useCluster } from "../../context/ClusterContext";
import { formatNodeName } from "../../utils/nodeFormat";

interface Packet {
  id: number;
  from: number;   // node id (0-indexed)
  to: number;     // node id (0-indexed)
  progress: number;
  blocked: boolean;
}

const W = 400, H = 290;
const CX = W / 2, CY = H / 2 + 10;
const RADIUS = 100;

const NODE_HEX = ["#60a5fa", "#4ade80", "#facc15", "#c084fc", "#f472b6", "#2dd4bf"];

interface PacketFlowProps {
  nodeNames: string[];
}

export function PacketFlow({ nodeNames }: PacketFlowProps) {
  const { nodes: runtimeNodes, isPartitioned } = useCluster();
  const [packets, setPackets] = useState<Packet[]>([]);
  const nextId = useRef(0);

  const total = nodeNames.length;

  const getPos = (i: number) => {
    if (total === 1) return { x: CX, y: CY };
    const angle = -Math.PI / 2 + (Math.PI * 2 * i) / total;
    return {
      x: CX + Math.cos(angle) * RADIUS,
      y: CY + Math.sin(angle) * RADIUS,
    };
  };

  useEffect(() => {
    if (total <= 1) return; // No replicas to send to

    const spawn = setInterval(() => {
      const id = nextId.current++;
      const to = 1 + (id % (total - 1)); // alternate across all replicas (1 to total-1)
      const toRuntime = runtimeNodes.find((n) => n.id === to);
      const blocked =
        isPartitioned(0, to) ||
        toRuntime?.state === "UNREACHABLE" ||
        toRuntime?.state === "SUSPECT";
      setPackets((p) => [
        ...p.slice(-20), // cap at 20 in-flight
        { id, from: 0, to, progress: 0, blocked },
      ]);
    }, 1600);

    const animate = setInterval(() => {
      setPackets((prev) =>
        prev
          .map((p) => ({
            ...p,
            // blocked packets slow to a halt at 45%
            progress: p.blocked
              ? Math.min(p.progress + 0.025, 0.46)
              : p.progress + 0.04,
          }))
          .filter((p) => p.progress < 1.01)
      );
    }, 50);

    return () => {
      clearInterval(spawn);
      clearInterval(animate);
    };
  }, [isPartitioned, runtimeNodes, total]);

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="overflow-visible">

      {/* Connection lines from Primary (0) to Replicas */}
      {Array.from({ length: total - 1 }).map((_, i) => {
        const to = i + 1;
        const part = isPartitioned(0, to);
        const runtime = runtimeNodes.find((n) => n.id === to);
        const degraded = part || runtime?.state === "UNREACHABLE" || runtime?.state === "SUSPECT";
        const fromPos = getPos(0);
        const toPos = getPos(to);
        return (
          <line key={`primary-${to}`}
            x1={fromPos.x} y1={fromPos.y}
            x2={toPos.x} y2={toPos.y}
            stroke={degraded ? "#7f1d1d" : "#3f3f46"}
            strokeWidth={degraded ? 2 : 1.5}
            strokeDasharray={degraded ? "8 5" : "5 4"}
          />
        );
      })}

      {/* Ring lines between replicas (for ring communication visualization) */}
      {Array.from({ length: total - 1 }).map((_, i) => {
        if (total <= 2) return null;
        const r1 = i + 1;
        const r2 = r1 === total - 1 ? 1 : r1 + 1;
        
        const n1 = runtimeNodes.find((n) => n.id === r1);
        const n2 = runtimeNodes.find((n) => n.id === r2);
        const part = isPartitioned(r1, r2);
        const degraded = part || n1?.state === "UNREACHABLE" || n2?.state === "UNREACHABLE";
        
        const pos1 = getPos(r1);
        const pos2 = getPos(r2);

        return (
          <line key={`rep-${r1}-${r2}`}
            x1={pos1.x} y1={pos1.y}
            x2={pos2.x} y2={pos2.y}
            stroke={degraded ? "#7f1d1d" : "#27272a"}
            strokeWidth={1}
            strokeDasharray="4 6"
            opacity={0.5}
          />
        );
      })}

      {/* Packets */}
      {packets.map((pkt) => {
        if (pkt.progress >= 1) return null;
        const from = getPos(pkt.from), to = getPos(pkt.to);
        const t = pkt.blocked ? Math.min(pkt.progress, 0.45) : pkt.progress;
        const px = from.x + (to.x - from.x) * t;
        const py = from.y + (to.y - from.y) * t;
        // Fade blocked packets out
        const opacity = pkt.blocked && pkt.progress > 0.35
          ? 1 - ((pkt.progress - 0.35) / 0.1)
          : 0.9;
        return (
          <circle key={pkt.id} cx={px} cy={py} r={5}
            fill={pkt.blocked ? "#f87171" : (NODE_HEX[pkt.to % NODE_HEX.length])}
            opacity={Math.max(0, opacity)}
          />
        );
      })}

      {/* Node circles */}
      {nodeNames.map((name, i) => {
        const runtime = runtimeNodes.find((n) => n.id === i);
        const isDown   = runtime?.state === "UNREACHABLE";
        const isSuspect = runtime?.state === "SUSPECT";
        const hex = isDown ? "#52525b" : NODE_HEX[i % NODE_HEX.length];
        const pos = getPos(i);
        return (
          <g key={i}>
            {/* Glow ring for failure states */}
            {(isDown || isSuspect) && (
              <circle cx={pos.x} cy={pos.y} r={32}
                fill="none"
                stroke={isDown ? "rgba(248,113,113,0.4)" : "rgba(250,204,21,0.4)"}
                strokeWidth={6}
                strokeDasharray={isDown ? "5 4" : "none"}
              />
            )}
            <circle cx={pos.x} cy={pos.y} r={26}
              fill="#18181b"
              stroke={hex}
              strokeWidth={2.5}
              opacity={isDown ? 0.4 : 1}
            />
            <text x={pos.x} y={pos.y} textAnchor="middle" dominantBaseline="middle"
              fill={hex} fontSize={10} fontWeight="bold">
              {isDown ? "✕" : formatNodeName(name)}
            </text>
            <text x={pos.x} y={pos.y + 14} textAnchor="middle"
              fill="#71717a" fontSize={8}>
              {isDown ? "DOWN" : isSuspect ? "SUSPECT" : i === 0 ? "PRIMARY" : "REPLICA"}
            </text>
          </g>
        );
      })}

    </svg>
  );
}
