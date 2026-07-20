import { CENTER } from "./ringConstants";
import type { RingNode, RingKey } from "../types/hashRing";
import { findOwner } from "./hashRing";

/**
 * Converts polar coordinates (angle in degrees, radius in px)
 * into {x, y} Cartesian coordinates relative to the ring canvas.
 */
export function polarToCartesian(
  angle: number,
  radius: number
): { x: number; y: number } {
  const rad = (angle * Math.PI) / 180;
  return {
    x: CENTER + radius * Math.cos(rad),
    y: CENTER + radius * Math.sin(rad),
  };
}

/**
 * Resolve which node ID owns a given key.
 *
 * - Backend data: key.owner is an addr string like "node0:7001".
 *   We look up the matching node by addr and return its id.
 * - Mock data: key.owner is undefined.
 *   We fall back to angle-based findOwner().
 */
export function resolveOwnerIndex(key: RingKey, nodes: RingNode[]): number {
  if (key.owner) {
    const found = nodes.find((n) => n.addr === key.owner);
    if (found) return found.id;
  }
  return findOwner(key.angle, nodes);
}
