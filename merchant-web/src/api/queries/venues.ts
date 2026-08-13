import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../client";
import type { components } from "../generated/menu";
import { itemsQueryKey, type ItemResponse } from "./menu";

export type VenueSummary = components["schemas"]["VenueSummary"];
export type VenueResponse = components["schemas"]["VenueResponse"];
export type CreateItemRequest = components["schemas"]["CreateItemRequest"];

export function venuesQueryKey() {
  return ["menu", "venues"] as const;
}

/**
 * Every venue menu-service knows about, newest first (the service does the ordering — see its
 * `listVenues`). This is the only way the UI can discover a venue: before `GET /venues` existed the
 * frontend could reach a venue only if its id had been baked into a build-time env var, which is
 * why the default docker-compose demo had no reachable menu screen at all.
 */
export function useVenues() {
  return useQuery({
    queryKey: venuesQueryKey(),
    queryFn: () => apiRequest<VenueSummary[]>("menu", "/venues"),
  });
}

/**
 * The three items a fresh demo venue starts with. Deliberately a mixed bag: one with a price and a
 * description, one cheap, one with no price at all — so the menu editor and the availability board
 * both have something non-uniform to show, and so `priceCents: null` renders on screen at least
 * once rather than only appearing when someone clears a field by hand.
 */
const DEMO_ITEMS: CreateItemRequest[] = [
  { name: "Cheeseburger", description: "Aged cheddar, house pickles", priceCents: 1450, sortOrder: 0 },
  { name: "Fries", description: "Rosemary salt", priceCents: 450, sortOrder: 1 },
  { name: "Soup of the day", description: "Ask your server", priceCents: null, sortOrder: 2 },
];

export interface CreateDemoVenueResult {
  venue: VenueResponse;
  items: ItemResponse[];
}

/**
 * Creates a venue and seeds it, through the real APIs — one `POST /venues` then one
 * `POST /venues/{id}/items` per item. Each of those is a genuine write with its own correlation ID,
 * its own outbox row, and its own `menu.events` publish, so the flow diagram and trace list light up
 * while this runs. That is the point: setup is itself the first demonstration, not a fixture load.
 *
 * Items are created sequentially rather than with `Promise.all` so their `sortOrder` lands in a
 * predictable order and so the resulting spans arrive as a legible sequence on the flow view
 * instead of three simultaneous pulses on the same edge.
 */
export function useCreateDemoVenue() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (name: string): Promise<CreateDemoVenueResult> => {
      const venue = await apiRequest<VenueResponse>("menu", "/venues", {
        method: "POST",
        body: { name },
      });

      const items: ItemResponse[] = [];
      for (const item of DEMO_ITEMS) {
        items.push(
          await apiRequest<ItemResponse>("menu", `/venues/${venue.id}/items`, {
            method: "POST",
            body: item,
          }),
        );
      }

      return { venue, items };
    },
    onSuccess: ({ venue, items }) => {
      queryClient.invalidateQueries({ queryKey: venuesQueryKey() });
      // Seed the items cache directly so navigating straight to the menu editor doesn't flash a
      // spinner for data this mutation already holds.
      queryClient.setQueryData<ItemResponse[]>(itemsQueryKey(venue.id), items);
    },
  });
}
