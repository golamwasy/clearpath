import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../client";
import type { components } from "../generated/pos-ingest";

export type SyncRun = components["schemas"]["SyncRun"];

export function syncRunsQueryKey(venue?: string) {
  return ["sync-runs", venue ?? "all"] as const;
}

export function useSyncRuns(venue?: string) {
  return useQuery({
    queryKey: syncRunsQueryKey(venue),
    queryFn: () => apiRequest<SyncRun[]>("pos", "/sync-runs", { query: { venue } }),
  });
}

export function useRetrySyncRun(venue?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiRequest<SyncRun>("pos", `/sync-runs/${id}/retry`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: syncRunsQueryKey(venue) });
    },
  });
}
