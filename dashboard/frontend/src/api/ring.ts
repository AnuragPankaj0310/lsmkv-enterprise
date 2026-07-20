import { apiFetch } from "./client";
import type { RingSnapshot } from "../types/hashRing";

export interface RingNode {
  id: number;
  addr: string;
  angle: number;
}

export interface RingKey {
  id: number;
  angle: number;
  owner: string;
}

/** GET /api/ring — full ring snapshot consumed by HashRingCanvas */
export async function getRing(): Promise<RingSnapshot> {
  return apiFetch<RingSnapshot>("/api/ring");
}

/** POST /api/add-node */
export async function addNode(address: string): Promise<{ ok: boolean; nodes: string[] }> {
  return apiFetch("/api/add-node", {
    method: "POST",
    body: JSON.stringify({ address }),
  });
}

/** POST /api/remove-node */
export async function removeNode(address: string): Promise<{ ok: boolean; nodes: string[] }> {
  return apiFetch("/api/remove-node", {
    method: "POST",
    body: JSON.stringify({ address }),
  });
}
