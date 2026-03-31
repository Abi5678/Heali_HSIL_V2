import { useCallback, useRef, useSyncExternalStore } from "react";
import type { UIEvent } from "./useVoiceGuardian";

/**
 * Lightweight global store for generative UI events emitted by backend tools.
 *
 * Backend tools call `emit_ui_update(target, data, tool_context)` which the
 * WebSocket hook receives as `{ target: "...", ...data }`.
 *
 * Pages subscribe to specific targets via `useUIEvent("pill_verified")`.
 */

type Listener = () => void;

// Global singleton store
const events: Record<string, UIEvent> = {};
const eventHistory: UIEvent[] = [];
const listeners = new Set<Listener>();

function emitChange() {
  listeners.forEach((l) => l());
}

/** Push a new UI event into the store. Called from the WebSocket hook. */
export function pushUIEvent(event: UIEvent) {
  events[event.target] = event;
  eventHistory.push(event);
  // Keep history bounded
  if (eventHistory.length > 100) eventHistory.shift();
  emitChange();
}

/** Clear events (e.g. on disconnect). */
export function clearUIEvents() {
  Object.keys(events).forEach((k) => delete events[k]);
  eventHistory.length = 0;
  emitChange();
}

/** Subscribe to the latest event for a specific target. */
export function useUIEvent(target: string): UIEvent | undefined {
  const getSnapshot = useCallback(() => events[target], [target]);
  const subscribe = useCallback((cb: Listener) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }, []);
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** Get all events in history (for rendering a feed). */
export function useUIEventHistory(): UIEvent[] {
  const ref = useRef(eventHistory);
  const getSnapshot = useCallback(() => {
    // Return new ref only when length changes
    if (ref.current.length !== eventHistory.length) {
      ref.current = [...eventHistory];
    }
    return ref.current;
  }, []);
  const subscribe = useCallback((cb: Listener) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }, []);
  return useSyncExternalStore(subscribe, getSnapshot);
}
