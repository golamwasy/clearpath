import { useSyncExternalStore } from "react";

/**
 * Two things the tour needs that aren't derivable from the span stream alone, recorded at the moment
 * they genuinely happen.
 *
 * Both are records of a *server outcome*, not of a user action: `recordTraceViewed` is called only
 * after trace-collector actually returned a trace, and `recordDuplicateDelivery` stores
 * availability-service's real verdict on a replayed event. Nothing here can be satisfied by clicking
 * — which is the whole point, since a tour that advanced on clicks would report success on a stack
 * with Kafka switched off.
 *
 * Same `useSyncExternalStore` shape as `correlationTracking.ts`, so this stays out of React context
 * and can be written from a query callback.
 */
export interface DuplicateDeliveryObservation {
  accepted: boolean;
  stateUnchanged: boolean;
}

interface Observations {
  viewedTraceCorrelationIds: readonly string[];
  duplicateDelivery: DuplicateDeliveryObservation | null;
}

/**
 * Mirrored to sessionStorage so a reload mid-demo doesn't silently un-tick steps the system really
 * did perform. This caches an observation that already happened; it never manufactures one — both
 * fields can only be written from a server response, and clearing the tab clears them.
 */
const STORAGE_KEY = "clearpath.tourObservations";

function readStored(): Observations {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { viewedTraceCorrelationIds: [], duplicateDelivery: null };
    const parsed = JSON.parse(raw) as Partial<Observations>;
    return {
      viewedTraceCorrelationIds: Array.isArray(parsed.viewedTraceCorrelationIds)
        ? parsed.viewedTraceCorrelationIds
        : [],
      duplicateDelivery: parsed.duplicateDelivery ?? null,
    };
  } catch {
    // Unreadable or malformed storage is treated as "nothing observed yet" — the steps re-tick as
    // soon as the operator does the thing again, which is the safe direction to fail in.
    return { viewedTraceCorrelationIds: [], duplicateDelivery: null };
  }
}

let observations: Observations = readStored();
const listeners = new Set<() => void>();

function emit() {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(observations));
  } catch {
    /* see readStored */
  }
  listeners.forEach((listener) => listener());
}

export function recordTraceViewed(correlationId: string) {
  if (observations.viewedTraceCorrelationIds.includes(correlationId)) return;
  observations = {
    ...observations,
    viewedTraceCorrelationIds: [...observations.viewedTraceCorrelationIds, correlationId],
  };
  emit();
}

export function recordDuplicateDelivery(result: DuplicateDeliveryObservation) {
  observations = { ...observations, duplicateDelivery: result };
  emit();
}

/** Test seam: module state otherwise leaks between tests. */
export function resetTourObservationsForTest() {
  observations = { viewedTraceCorrelationIds: [], duplicateDelivery: null };
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return observations;
}

export function useTourObservations(): Observations {
  return useSyncExternalStore(subscribe, getSnapshot);
}
