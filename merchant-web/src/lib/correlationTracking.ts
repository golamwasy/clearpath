import { useSyncExternalStore } from "react";

/**
 * Tracks the correlation ID of the most recent write (POST/PUT/DELETE) this app made, so the UI
 * can offer "view the trace of the change I just made" without the merchant having to manually
 * browse /system/traces and guess which trace was theirs. Every backend hop already propagates
 * X-Correlation-Id (CLAUDE.md invariant 3) — the frontend, the actual origin of every merchant
 * action, was the one link in the chain not doing it.
 */
let lastWriteCorrelationId: string | null = null;
const listeners = new Set<() => void>();

export function recordWriteCorrelationId(id: string) {
  lastWriteCorrelationId = id;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return lastWriteCorrelationId;
}

export function useLastWriteCorrelationId(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot);
}

export function newCorrelationId(): string {
  return crypto.randomUUID();
}
