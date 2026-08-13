import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../client";
import type { components } from "../generated/trace";

export type TraceSummary = components["schemas"]["TraceSummary"];
export type Span = components["schemas"]["Span"];

const TRACE_LIST_POLL_INTERVAL_MS = 5000;

export function tracesQueryKey() {
  return ["traces"] as const;
}

export function useTraces(limit = 50) {
  return useQuery({
    queryKey: tracesQueryKey(),
    queryFn: () => apiRequest<TraceSummary[]>("trace", "/traces", { query: { limit } }),
    refetchInterval: TRACE_LIST_POLL_INTERVAL_MS,
  });
}

export function traceQueryKey(correlationId: string) {
  return ["traces", correlationId] as const;
}

/**
 * A trace is not complete when it is first requested: spans arrive at trace-collector asynchronously
 * over `system.trace`, so the later hops of a write can land after the first fetch returns. Fetching
 * once meant a caller could hold a permanently partial trace — the guided tour got stuck reporting a
 * step incomplete for a write that had in fact finished, until something else forced a refetch.
 *
 * `refetchIntervalMs` lets a caller keep an open trace up to date. Off by default, so nothing polls
 * unless it has a reason to.
 */
export function useTrace(correlationId: string, options: { refetchIntervalMs?: number } = {}) {
  return useQuery({
    queryKey: traceQueryKey(correlationId),
    queryFn: () => apiRequest<Span[]>("trace", `/traces/${correlationId}`),
    enabled: Boolean(correlationId),
    refetchInterval: options.refetchIntervalMs ?? false,
    // TanStack pauses interval refetching while the tab is unfocused. That is a sensible default
    // for most data, but this query is how the UI learns that a write finished propagating — with
    // it paused, a trace fetched mid-flight stays permanently partial in any window that is not in
    // the foreground, which is exactly the case when a demo is on a second monitor or the operator
    // is watching the flow view in another tab.
    refetchIntervalInBackground: true,
  });
}
