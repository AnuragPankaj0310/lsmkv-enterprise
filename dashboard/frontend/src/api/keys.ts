import { apiFetch } from "./client";

export interface KeyEntry {
  key: string;
  value: string;
}

/** POST /api/keys — write a real key to the live cluster */
export async function setKey(key: string, value: string): Promise<{ ok: boolean; key: string; value: string }> {
  return apiFetch("/api/keys", {
    method: "POST",
    body: JSON.stringify({ key, value }),
  });
}

/** GET /api/keys/:key — read a real key from the live cluster */
export async function getKey(key: string): Promise<{ ok: boolean; key: string; value: string }> {
  return apiFetch(`/api/keys/${encodeURIComponent(key)}`);
}

/** DELETE /api/keys/:key — delete a real key from the live cluster */
export async function deleteKey(key: string): Promise<{ ok: boolean; key: string }> {
  return apiFetch(`/api/keys/${encodeURIComponent(key)}`, { method: "DELETE" });
}
