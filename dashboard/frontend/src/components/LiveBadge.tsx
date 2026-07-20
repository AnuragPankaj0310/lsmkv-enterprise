/**
 * LiveBadge — Per-page synchronization status indicator.
 *
 * Shows in the top-right of every monitoring page.
 *
 * Two modes:
 *   "polling"   — reads from clusterStore (REST, 5s interval)
 *   "websocket" — reads wsConnected/wsLastTs props (WS stream)
 */
import { useClusterStore } from "../store/clusterStore";

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

interface Props {
  /** "polling" = REST-backed (reads clusterStore). "websocket" = WS-backed (reads wsConnected prop). */
  mode?: "polling" | "websocket";
  /** Only for mode="websocket": whether the WS connection is up */
  wsConnected?: boolean;
  /** Only for mode="websocket": server timestamp of last WS message (seconds, not ms) */
  wsLastTs?: number | null;
  /** Human-readable refresh label shown in the badge */
  refreshLabel?: string;
}

export default function LiveBadge({
  mode = "polling",
  wsConnected,
  wsLastTs,
  refreshLabel,
}: Props) {
  const connected  = useClusterStore(s => s.connected);
  const lastSyncAt = useClusterStore(s => s.lastSyncAt);

  const isLive  = mode === "websocket" ? !!wsConnected  : connected;
  const lastAt  = mode === "websocket"
    ? (wsLastTs ? wsLastTs * 1000 : null)
    : lastSyncAt;

  const defaultRefreshLabel = mode === "websocket" ? "500ms" : "5 sec";
  const label = refreshLabel ?? defaultRefreshLabel;

  return (
    <div
      className={`rounded-xl border px-3 py-2 text-[11px] space-y-0.5 min-w-[170px] shrink-0 ${
        isLive
          ? "border-green-800/60 bg-green-950/10"
          : "border-zinc-700 bg-zinc-900/60"
      }`}
    >
      {/* Status row */}
      <div className="flex items-center gap-1.5 font-bold">
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            isLive ? "bg-green-400 animate-pulse" : "bg-red-500"
          }`}
        />
        <span className={isLive ? "text-green-400" : "text-red-400"}>
          {isLive ? "LIVE" : "OFFLINE"}
        </span>
      </div>

      {/* Description */}
      <div className="text-zinc-500">
        {isLive
          ? mode === "websocket"
            ? "WebSocket connected"
            : "Backend synchronized"
          : "Showing cached data"}
      </div>

      {/* Timestamp */}
      {lastAt && (
        <div className="text-zinc-600 font-mono">
          Last update: {fmtTime(lastAt)}
        </div>
      )}

      {/* Refresh rate */}
      {isLive && (
        <div className="text-zinc-600">
          {mode === "websocket" ? `Updates: ${label}` : `Auto refresh: ${label}`}
        </div>
      )}
    </div>
  );
}
