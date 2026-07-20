/**
 * Base URL for all API calls.
 *
 * Empty string (default): Nginx in production routes /api/* → FastAPI.
 * Vite dev proxy (vite.config.ts) does the same during `npm run dev`.
 *
 * VITE_API_URL (set on Vercel): absolute URL of the Railway/Render backend,
 * e.g. "https://my-kv-api.up.railway.app".  The frontend then calls
 * fetch(`${API_BASE}/cluster`) → absolute cross-origin request.
 */
export const API_BASE: string = (import.meta.env.VITE_API_URL as string) ?? "";

/** Shared fetch helper with basic error handling. */
export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  // In full-stack mode (Railway/local) path is already /api/cluster etc.
  // In split mode (Vercel + Railway) API_BASE is the Railway URL and
  // path must NOT include /api/ prefix because the Railway API serves / directly.
  const url = API_BASE ? `${API_BASE}${path.replace(/^\/api/, "")}` : path;
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `API error ${res.status}`);
  }

  return res.json() as Promise<T>;
}
