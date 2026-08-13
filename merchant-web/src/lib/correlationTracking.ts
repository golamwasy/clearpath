import { useSyncExternalStore } from "react";

/**
 * Tracks the correlation ID of the most recent *merchant* write this app made, so the UI can offer
 * "view the trace of the change I just made" without the merchant having to browse /system/traces
 * and guess which trace was theirs. Every backend hop already propagates X-Correlation-Id
 * (CLAUDE.md invariant 3) — the frontend, the actual origin of every merchant action, was the one
 * link in the chain not doing it.
 *
 * Chaos-panel mutations are deliberately excluded. They are writes in the HTTP sense, but they are
 * not something the merchant changed, and recording them meant that firing a duplicate delivery
 * silently repointed "your last change" at the chaos request — so the sidebar link, and the tour
 * steps derived from that correlation ID, stopped describing the price edit they were about.
 */
/**
 * Mirrored to sessionStorage so a page reload doesn't lose the thread between "the merchant did
 * something" and "here is its trace". Only the ID is kept — the spans themselves are always re-read
 * from trace-collector, so nothing here can outlive or contradict the real record.
 */
const STORAGE_KEY = "clearpath.lastWriteCorrelationId";

function readStored(): string | null {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    // Private-browsing modes and some embedded webviews throw on storage access; losing the ID
    // across reloads beats failing to render.
    return null;
  }
}

let lastWriteCorrelationId: string | null = readStored();
const listeners = new Set<() => void>();

export function recordWriteCorrelationId(id: string) {
  lastWriteCorrelationId = id;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* see readStored */
  }
  listeners.forEach((listener) => listener());
}

/** Test seam: module state otherwise leaks between tests. */
export function resetCorrelationTrackingForTest() {
  lastWriteCorrelationId = null;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* see readStored */
  }
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
