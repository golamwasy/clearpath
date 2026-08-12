import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { apiRequest, ApiError } from "../client";
import type { components } from "../generated/menu";

export type ItemResponse = components["schemas"]["ItemResponse"];
export type UpdateItemRequest = components["schemas"]["UpdateItemRequest"];
export type ConflictResponse = components["schemas"]["ConflictResponse"];

export function itemsQueryKey(venueId: string) {
  return ["menu", "items", venueId] as const;
}

export function useVenueItems(venueId: string) {
  return useQuery({
    queryKey: itemsQueryKey(venueId),
    queryFn: () => apiRequest<ItemResponse[]>("menu", `/venues/${venueId}/items`),
    enabled: Boolean(venueId),
  });
}

interface UpdateItemVariables {
  venueId: string;
  itemId: string;
  patch: UpdateItemRequest;
}

/** Thrown-through ApiError body, narrowed to the 409 shape for callers that need `current`. */
export function isConflict(error: unknown): error is ApiError & { body: ConflictResponse } {
  return error instanceof ApiError && error.status === 409;
}

function snapshotItems(queryClient: QueryClient, venueId: string) {
  return queryClient.getQueryData<ItemResponse[]>(itemsQueryKey(venueId));
}

export function useUpdateItem(venueId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ itemId, patch }: UpdateItemVariables) =>
      apiRequest<ItemResponse>("menu", `/venues/${venueId}/items/${itemId}`, {
        method: "PUT",
        body: patch,
      }),
    onMutate: async ({ itemId, patch }) => {
      await queryClient.cancelQueries({ queryKey: itemsQueryKey(venueId) });
      const previous = snapshotItems(queryClient, venueId);
      queryClient.setQueryData<ItemResponse[]>(itemsQueryKey(venueId), (items) =>
        items?.map((item) => (item.id === itemId ? { ...item, ...patch } : item)),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(itemsQueryKey(venueId), context.previous);
      }
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<ItemResponse[]>(itemsQueryKey(venueId), (items) =>
        items?.map((item) => (item.id === updated.id ? updated : item)),
      );
    },
  });
}

/**
 * Reorders items client-side and PUTs each row whose sortOrder changed.
 * Optimistic: the whole list snapshot is captured before mutating so any
 * single PUT failure (including a 409) can roll every row back, not just
 * the one that failed — a partial reorder is worse than no reorder.
 */
export function useReorderItems(venueId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (reordered: ItemResponse[]) => {
      // Each item still carries its pre-move sortOrder (move() reorders positions,
      // not the item objects themselves), so diffing against the new index doesn't
      // need a cache snapshot - which is good, because onMutate below has already
      // overwritten the cache with the new order by the time this runs, so reading
      // it back here would show everything as "unchanged."
      const changed = reordered.filter((item, index) => item.sortOrder !== index);

      const results = await Promise.all(
        changed.map((item) => {
          const index = reordered.findIndex((i) => i.id === item.id);
          return apiRequest<ItemResponse>("menu", `/venues/${venueId}/items/${item.id}`, {
            method: "PUT",
            body: {
              version: item.version,
              name: item.name,
              description: item.description,
              categoryId: item.categoryId,
              priceCents: item.priceCents,
              sortOrder: index,
            } satisfies UpdateItemRequest,
          });
        }),
      );
      return results;
    },
    onMutate: async (reordered: ItemResponse[]) => {
      await queryClient.cancelQueries({ queryKey: itemsQueryKey(venueId) });
      const previous = snapshotItems(queryClient, venueId);
      queryClient.setQueryData<ItemResponse[]>(
        itemsQueryKey(venueId),
        reordered.map((item, index) => ({ ...item, sortOrder: index })),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(itemsQueryKey(venueId), context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: itemsQueryKey(venueId) });
    },
  });
}
