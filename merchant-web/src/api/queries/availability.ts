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

/**
 * Availability is the near-real-time half of CLAUDE.md invariant 4, but nothing here pushed: the
 * query fetched once on mount and then sat. An item created seconds earlier would render as having
 * no known state and stay that way indefinitely, even after availability-service had consumed the
 * event and written Redis — the screen showed a stale answer to a question whose real answer had
 * already changed.
 *
 * Polling is the honest fix at this size. There is no availability push channel (`stock.events` has
 * no producer or consumer yet), so the UI cannot subscribe to changes; a short interval keeps the
 * board close to the store it claims to reflect, and the screen's source tag says "polled 3s" rather
 * than implying a live feed it does not have.
 */
const AVAILABILITY_POLL_MS = 3000;

export function useVenueAvailability(venueId: string) {
  return useQuery({
    queryKey: availabilityQueryKey(venueId),
    queryFn: () =>
      apiRequest<AvailabilityResponse>("availability", `/venues/${venueId}/availability`),
    enabled: Boolean(venueId),
    refetchInterval: AVAILABILITY_POLL_MS,
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
