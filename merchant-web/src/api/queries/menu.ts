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
 * Optimistic: the whole list snapshot is captured before mutating. If any PUT fails (including a
 * 409), every row that *did* succeed is put back to its pre-reorder sortOrder with a compensating
 * PUT (using the version the server just returned, so that compensating write's own optimistic
 * lock doesn't spuriously conflict) before the mutation throws — a partial reorder is worse than
 * no reorder, and a client-side cache reset alone doesn't undo what already committed
 * server-side.
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

      const settled = await Promise.allSettled(
        changed.map(async (item) => {
          const index = reordered.findIndex((i) => i.id === item.id);
          const updated = await apiRequest<ItemResponse>("menu", `/venues/${venueId}/items/${item.id}`, {
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
          return { original: item, updated };
        }),
      );

      const succeeded = settled.filter(
        (r): r is PromiseFulfilledResult<{ original: ItemResponse; updated: ItemResponse }> => r.status === "fulfilled",
      );
      const failures = settled.filter((r): r is PromiseRejectedResult => r.status === "rejected");

      if (failures.length > 0) {
        const compensated = await Promise.allSettled(
          succeeded.map(({ original, updated }) =>
            apiRequest<ItemResponse>("menu", `/venues/${venueId}/items/${original.id}`, {
              method: "PUT",
              body: {
                version: updated.version,
                name: updated.name,
                description: updated.description,
                categoryId: updated.categoryId,
                priceCents: updated.priceCents,
                sortOrder: original.sortOrder,
              } satisfies UpdateItemRequest,
            }),
          ),
        );
        // A compensating PUT can itself fail (e.g. that row was touched by another concurrent
        // edit in the meantime) — there's no further fallback for that, but it must not be a
        // silent no-op: the client cache reset in onError below would otherwise show an order
        // that doesn't match what's actually on the server for that item.
        const compensationFailures = compensated.filter(
          (r): r is PromiseRejectedResult => r.status === "rejected",
        );
        if (compensationFailures.length > 0) {
          console.error(
            `useReorderItems: ${compensationFailures.length} compensating PUT(s) failed after a reorder rollback — server-side order may not match the pre-reorder snapshot the UI reverted to`,
            compensationFailures.map((r) => r.reason),
          );
        }
        throw failures[0].reason;
      }

      return succeeded.map((r) => r.value.updated);
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
