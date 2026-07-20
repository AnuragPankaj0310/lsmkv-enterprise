/**
 * hashRing.ts — pure utility functions for the consistent hash ring.
 * Types live in src/types/hashRing.ts; re-exported here for convenience.
 */
export type { RingNode, RingKey } from "../types/hashRing";
import type { RingNode, RingKey } from "../types/hashRing";

export function generateKeys(count: number): RingKey[] {
  const keys: RingKey[] = [];

  for (let i = 0; i < count; i++) {
    keys.push({
      id: i + 1,
      // deterministic golden-angle distribution
      angle: (i * 137.508) % 360,
    });
  }

  return keys;
}

export function findOwner(
  angle: number,
  nodes: RingNode[]
): number {
  const sorted = [...nodes].sort((a, b) => a.angle - b.angle);

  for (const node of sorted) {
    if (angle <= node.angle) return node.id;
  }

  // wrap-around: assign to the first node
  return sorted[0].id;
}