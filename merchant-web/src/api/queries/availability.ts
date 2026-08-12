import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../client";
import type { components } from "../generated/availability";

export type AvailabilityState = components["schemas"]["AvailabilityState"];
export type AvailabilityResponse = components["schemas"]["AvailabilityResponse"];
export type UpdateAvailabilityRequest = components["schemas"]["UpdateAvailabilityRequest"];
export type AvailabilityStatus = components["schemas"]["AvailabilityStatus"];

export function availabilityQueryKey(venueId: string) {
  return ["availability", venueId] as const;
}

export function useVenueAvailability(venueId: string) {
  return useQuery({
    queryKey: availabilityQueryKey(venueId),
    queryFn: () =>
      apiRequest<AvailabilityResponse>("availability", `/venues/${venueId}/availability`),
    enabled: Boolean(venueId),
  });
}

interface UpdateAvailabilityVariables {
  itemId: string;
  request: UpdateAvailabilityRequest;
}

export function useUpdateAvailability(venueId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ itemId, request }: UpdateAvailabilityVariables) =>
      apiRequest<AvailabilityState>(
        "availability",
        `/venues/${venueId}/items/${itemId}/availability`,
        { method: "PUT", body: request },
      ),
    onMutate: async ({ itemId, request }) => {
      await queryClient.cancelQueries({ queryKey: availabilityQueryKey(venueId) });
      const previous = queryClient.getQueryData<AvailabilityResponse>(
        availabilityQueryKey(venueId),
      );
      queryClient.setQueryData<AvailabilityResponse>(availabilityQueryKey(venueId), (data) =>
        data
          ? {
              items: data.items.map((entry) =>
                entry.itemId === itemId
                  ? { ...entry, status: request.status, soldOutUntil: request.soldOutUntil ?? null }
                  : entry,
              ),
            }
          : data,
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(availabilityQueryKey(venueId), context.previous);
      }
    },
    onSettled: () => {
      // Near-real-time data (CLAUDE.md invariant 4): always refetch on settle
      // so a second tab's next poll reflects the true server state, last
      // write wins, no optimistic-lock conflict UI on this screen.
      queryClient.invalidateQueries({ queryKey: availabilityQueryKey(venueId) });
    },
  });
}
