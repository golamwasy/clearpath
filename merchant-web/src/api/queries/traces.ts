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

export function useTrace(correlationId: string) {
  return useQuery({
    queryKey: traceQueryKey(correlationId),
    queryFn: () => apiRequest<Span[]>("trace", `/traces/${correlationId}`),
    enabled: Boolean(correlationId),
  });
}
