import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, ApiError } from "../client";
import type { components as AvailabilityComponents } from "../generated/availability";
import type { components as PosComponents } from "../generated/pos-ingest";
import { availabilityQueryKey } from "./availability";

export type AvailabilityChaosState = AvailabilityComponents["schemas"]["ChaosStateResponse"];
export type DuplicateDeliveryResponse = AvailabilityComponents["schemas"]["DuplicateDeliveryResponse"];
export type PosChaosState = PosComponents["schemas"]["ChaosState"];

/** True when a chaos query/mutation failed because CHAOS_ENABLED=false on the backend. */
export function isChaosDisabled(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

const availabilityChaosKey = ["chaos", "availability"] as const;
const posChaosKey = ["chaos", "pos"] as const;

export function useAvailabilityChaosState() {
  return useQuery({
    queryKey: availabilityChaosKey,
    queryFn: () => apiRequest<AvailabilityChaosState>("availability", "/chaos/state"),
    retry: false,
  });
}

export function usePosChaosState() {
  return useQuery({
    queryKey: posChaosKey,
    queryFn: () => apiRequest<PosChaosState>("pos", "/chaos/state"),
    retry: false,
  });
}

function useAvailabilityChaosAction(path: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiRequest<AvailabilityChaosState>("availability", path, { method: "POST", isControlPlane: true }),
    onSuccess: (state) => queryClient.setQueryData(availabilityChaosKey, state),
  });
}

export function usePauseConsumer() {
  return useAvailabilityChaosAction("/chaos/consumer/pause");
}

export function useResumeConsumer() {
  return useAvailabilityChaosAction("/chaos/consumer/resume");
}

export function useBreakRedis() {
  return useAvailabilityChaosAction("/chaos/redis/break");
}

export function useRestoreRedis() {
  return useAvailabilityChaosAction("/chaos/redis/restore");
}

/** Fires the headline duplicate-delivery replay, then invalidates availability so callers can diff before/after. */
export function useDuplicateDelivery(venueId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiRequest<DuplicateDeliveryResponse>("availability", "/chaos/duplicate-delivery", { method: "POST", isControlPlane: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: availabilityQueryKey(venueId) });
    },
  });
}

export function useSetPosLatency() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ms: number) => apiRequest<PosChaosState>("pos", "/chaos/latency", { method: "POST", body: { ms }, isControlPlane: true }),
    onSuccess: (state) => queryClient.setQueryData(posChaosKey, state),
  });
}
