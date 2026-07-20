/**
 * RebalancingTokens — renders animated key-migration dots that travel
 * along the ring arc from one node to another when rebalancing is active.
 *
 * Driven entirely from ClusterContext: activates when any node is REBALANCING.
 */
import { useEffect, useRef, useState } from "react";
import type { RingNode } from "../../types/hashRing";
import { CENTER, NODE_RADIUS } from "../../utils/ringConstants";

interface MigrationToken {
  id: number;
  fromAngle: number;   // degrees on ring
  toAngle: number;     // degrees on ring
  progress: number;    // 0..1 — arc interpolation
  color: string;
  label: string;
}

interface Props {
  nodes: RingNode[];
  rebalancingNodeIds: number[];   // 0-indexed node IDs currently rebalancing
}

const NODE_HEX = ["#60a5fa", "#4ade80", "#facc15", "#c084fc", "#f472b6", "#2dd4bf"];

let _tokenId = 0;

/** Interpolate angle along the shorter arc between a and b */
function arcLerp(a: number, b: number, t: number): number {
  let diff = ((b - a + 540) % 360) - 180; // shortest arc delta
  return (a + diff * t + 360) % 360;
}

/** Polar → cartesian for the ring SVG (center at RING_SIZE/2) */
function ringPoint(angleDeg: number, r: number): { x: number; y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: CENTER + Math.cos(rad) * r,
    y: CENTER + Math.sin(rad) * r,
  };
}

export default function RebalancingTokens({ nodes, rebalancingNodeIds }: Props) {
  const [tokens, setTokens] = useState<MigrationToken[]>([]);
  const intervalRefs = useRef<ReturnType<typeof setInterval>[]>([]);

  useEffect(() => {
    intervalRefs.current.forEach(clearInterval);
    intervalRefs.current = [];

    if (rebalancingNodeIds.length === 0 || nodes.length < 2) {
      setTokens([]);
      return;
    }

    // Spawn a new migration token every 600ms
    const spawnId = setInterval(() => {
      // Pick a source node (rebalancing) and a random destination
      const srcIdx = rebalancingNodeIds[Math.floor(Math.random() * rebalancingNodeIds.length)];
      const srcNode = nodes.find((n) => n.id === srcIdx + 1); // ring uses 1-indexed ids
      if (!srcNode) return;

      const dstCandidates = nodes.filter((n) => n.id !== srcNode.id);
      if (dstCandidates.length === 0) return;
      const dstNode = dstCandidates[Math.floor(Math.random() * dstCandidates.length)];

      setTokens((prev) => [
        ...prev.slice(-20), // cap at 20 active tokens
        {
          id: _tokenId++,
          fromAngle: srcNode.angle,
          toAngle: dstNode.angle,
          progress: 0,
          color: NODE_HEX[(srcIdx) % NODE_HEX.length],
          label: `k${Math.floor(Math.random() * 9999)}`,
        },
      ]);
    }, 600);

    // Advance all token progress
    const animId = setInterval(() => {
      setTokens((prev) =>
        prev
          .map((t) => ({ ...t, progress: t.progress + 0.018 }))
          .filter((t) => t.progress <= 1.05)
      );
    }, 30);

    intervalRefs.current = [spawnId, animId];
    return () => {
      intervalRefs.current.forEach(clearInterval);
    };
  }, [rebalancingNodeIds, nodes]);

  if (tokens.length === 0) return null;

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      width="100%"
      height="100%"
      viewBox={`0 0 ${CENTER * 2} ${CENTER * 2}`}
      overflow="visible"
    >
      {tokens.map((tok) => {
        const angle = arcLerp(tok.fromAngle, tok.toAngle, tok.progress);
        const { x, y } = ringPoint(angle, NODE_RADIUS);
        // Fade in/out at start and end
        const alpha =
          tok.progress < 0.1 ? tok.progress * 10
          : tok.progress > 0.85 ? (1 - tok.progress) * (1 / 0.15)
          : 1;

        return (
          <g key={tok.id} opacity={Math.max(0, Math.min(1, alpha))}>
            {/* Glow ring */}
            <circle cx={x} cy={y} r={8} fill={tok.color} opacity={0.2} />
            {/* Main dot */}
            <circle cx={x} cy={y} r={5} fill={tok.color} />
            {/* Key label */}
            <text
              x={x}
              y={y - 10}
              textAnchor="middle"
              fill={tok.color}
              fontSize={7}
              fontFamily="monospace"
              opacity={0.85}
            >
              {tok.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
