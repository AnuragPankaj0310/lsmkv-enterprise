import type { ClusterEvent } from "../types/failure";

type Handler = (event: ClusterEvent) => void;

/**
 * Lightweight synchronous event bus.
 *
 * Usage:
 *   eventBus.subscribe(handler)      — register listener
 *   eventBus.unsubscribe(handler)    — remove listener
 *   eventBus.emit(event)             — fire to all subscribers
 *   eventBus.history()               — read-only log of all past events
 */
class EventBus {
  private _handlers: Set<Handler> = new Set();
  private _history: ClusterEvent[] = [];

  subscribe(handler: Handler): void {
    this._handlers.add(handler);
  }

  unsubscribe(handler: Handler): void {
    this._handlers.delete(handler);
  }

  emit(event: ClusterEvent): void {
    // Stamp timestamp if missing
    if (!event.timestamp) event.timestamp = Date.now();
    this._history = [...this._history.slice(-499), event]; // keep last 500
    this._handlers.forEach((h) => {
      try { h(event); } catch { /* isolate bad handlers */ }
    });
  }

  /** Immutable snapshot of the event log */
  history(): readonly ClusterEvent[] {
    return this._history;
  }

  /** Drain history (e.g. for replay) */
  clear(): void {
    this._history = [];
  }
}

/** Singleton — import this everywhere, never instantiate a second one. */
export const eventBus = new EventBus();
