import { API_BASE } from "./client";

type RingUpdateHandler = (data: unknown) => void;

/**
 * WebSocket client for live ring updates.
 *
 * Usage:
 *   const ws = createRingSocket((data) => {
 *     if (data.event === "ring_update") setRing(data.data);
 *   });
 *
 *   // cleanup
 *   ws.close();
 */
export function createRingSocket(onMessage: RingUpdateHandler): WebSocket {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  const wsBase = `${proto}://${window.location.host}`;
  const ws = new WebSocket(`${wsBase}/ws`);

  ws.onopen = () => {
    console.log("[ws] connected to ring stream");
    // Keep-alive ping every 30 s
    const ping = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send("ping");
    }, 30_000);
    ws.onclose = () => clearInterval(ping);
  };

  ws.onmessage = (evt) => {
    try {
      const parsed = JSON.parse(evt.data);
      onMessage(parsed);
    } catch {
      // ignore non-JSON frames (e.g. "pong")
    }
  };

  ws.onerror = (err) => {
    console.warn("[ws] ring socket error", err);
  };

  return ws;
}
