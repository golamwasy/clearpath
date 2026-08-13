import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Table, THead, TBody, Th } from "../../components/ui/Table";
import { PageHeader } from "../../components/ui/PageHeader";
import { InlineError } from "../../components/ui/InlineError";
import { Spinner } from "../../components/ui/Spinner";
import { SourceTag } from "../../components/ui/SourceTag";
import { InvariantBadge } from "../../components/ui/InvariantBadge";
import { EmptyState } from "../../components/ui/EmptyState";
import { Link } from "react-router-dom";
import { ItemRow } from "./ItemRow";
import {
  isConflict,
  itemsQueryKey,
  useReorderItems,
  useUpdateItem,
  useVenueItems,
  type ItemResponse,
} from "../../api/queries/menu";

export function MenuEditor() {
  const { venueId } = useParams<{ venueId: string }>();
  const { data: items, isLoading, isError, error } = useVenueItems(venueId ?? "");
  const updateItem = useUpdateItem(venueId ?? "");
  const reorderItems = useReorderItems(venueId ?? "");
  const queryClient = useQueryClient();

  // itemId -> server's current state on 409, or null if the row is gone.
  const [conflicts, setConflicts] = useState<Record<string, ItemResponse | null>>({});

  if (!venueId) {
    return <InlineError>No venue selected. Navigate to /venues/:venueId/menu.</InlineError>;
  }

  if (isLoading) return <Spinner label="Loading menu items" />;

  if (isError) {
    return <InlineError>Failed to load menu items: {(error as Error).message}</InlineError>;
  }

  const sorted = [...(items ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);

  function commitPrice(item: ItemResponse, nextCents: number | null) {
    setConflicts((prev) => {
      const { [item.id]: _dropped, ...rest } = prev;
      return rest;
    });
    updateItem.mutate(
      {
        venueId: venueId!,
        itemId: item.id,
        patch: {
          version: item.version,
          name: item.name,
          description: item.description,
          categoryId: item.categoryId,
          priceCents: nextCents,
          sortOrder: item.sortOrder,
        },
      },
      {
        onError: (err) => {
          if (isConflict(err)) {
            setConflicts((prev) => ({ ...prev, [item.id]: err.body.current ?? null }));
          }
        },
      },
    );
  }

  // Pulls the server's current values (from the 409 body) into the cache so
  // the next edit's PUT carries the real version instead of retrying
  // against the stale one, which would just 409 again.
  function acknowledgeConflict(itemId: string, current: ItemResponse | null) {
    setConflicts((prev) => {
      const { [itemId]: _dropped, ...rest } = prev;
      return rest;
    });
    if (current) {
      queryClient.setQueryData<ItemResponse[]>(itemsQueryKey(venueId!), (existing) =>
        existing?.map((item) => (item.id === itemId ? current : item)),
      );
    }
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= sorted.length) return;
    const next = [...sorted];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    reorderItems.mutate(next);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Menu"
        subtitle={
          <>
            {sorted.length} {sorted.length === 1 ? "item" : "items"} · click a price to edit, use the
            arrows to reorder. Each edit commits the item row and an outbox row in one transaction,
            then the relay publishes to menu.events.{" "}
            <InvariantBadge n={1} />
          </>
        }
        source={<SourceTag origin="menu-service · Postgres" freshness="on load" />}
      />
      <Table>
        <THead>
          <tr>
            <Th>Reorder</Th>
            <Th>Name</Th>
            <Th>Description</Th>
            <Th>Category</Th>
            <Th>Price</Th>
            <Th>Version</Th>
          </tr>
        </THead>
        <TBody>
          {sorted.map((item, index) => (
            <ItemRow
              key={item.id}
              item={item}
              conflict={conflicts[item.id]}
              onPriceCommit={(nextCents) => commitPrice(item, nextCents)}
              onAcknowledgeConflict={(current) => acknowledgeConflict(item.id, current)}
              onMoveUp={() => move(index, -1)}
              onMoveDown={() => move(index, 1)}
              canMoveUp={index > 0}
              canMoveDown={index < sorted.length - 1}
              disabled={updateItem.isPending || reorderItems.isPending}
            />
          ))}
        </TBody>
      </Table>
      {sorted.length === 0 && (
        <EmptyState
          title="This venue has no items"
          reason="menu-service has this venue but no item rows under it, so there is nothing to price or reorder — and nothing for availability-service to hear about."
          fills="Creating an item is a write: one Postgres transaction, one outbox row, one menu.events publish. You will see it cross the flow diagram."
          action={
            <Link to="/">
              <span className="text-sm font-medium text-blue-700 hover:underline">
                Set up a venue with a sample menu →
              </span>
            </Link>
          }
        />
      )}
    </div>
  );
}
