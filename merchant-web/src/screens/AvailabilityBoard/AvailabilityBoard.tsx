import { useParams } from "react-router-dom";
import { Table, THead, TBody, Th, Td } from "../../components/ui/Table";
import { PageHeader } from "../../components/ui/PageHeader";
import { InlineError } from "../../components/ui/InlineError";
import { Spinner } from "../../components/ui/Spinner";
import { AvailabilityCell } from "./AvailabilityCell";
import { useUpdateAvailability, useVenueAvailability } from "../../api/queries/availability";
import { useVenueItems } from "../../api/queries/menu";

export function AvailabilityBoard() {
  const { venueId } = useParams<{ venueId: string }>();
  const {
    data: availability,
    isLoading: availabilityLoading,
    isError: availabilityError,
    error: availabilityErrorObj,
  } = useVenueAvailability(venueId ?? "");
  const { data: items, isLoading: itemsLoading } = useVenueItems(venueId ?? "");
  const updateAvailability = useUpdateAvailability(venueId ?? "");

  if (!venueId) {
    return <InlineError>No venue selected. Navigate to /venues/:venueId/availability.</InlineError>;
  }

  if (availabilityLoading || itemsLoading) return <Spinner label="Loading availability" />;

  if (availabilityError) {
    return <InlineError>Failed to load availability: {(availabilityErrorObj as Error).message}</InlineError>;
  }

  const itemNames = new Map((items ?? []).map((item) => [item.id, item.name]));
  const stateByItem = new Map((availability?.items ?? []).map((entry) => [entry.itemId, entry]));

  // Union of every item id we know about from either source — an item with
  // no availability row yet (never touched by menu.events or the manual
  // endpoint) still gets a row, defaulting to "in stock" in the cell.
  const itemIds = new Set<string>([...itemNames.keys(), ...stateByItem.keys()]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Availability"
        subtitle={`${itemIds.size} ${itemIds.size === 1 ? "item" : "items"} · click a status to change it`}
      />
      <Table>
        <THead>
          <tr>
            <Th>Item</Th>
            <Th>Status</Th>
          </tr>
        </THead>
        <TBody>
          {[...itemIds].map((itemId) => {
            const label = itemNames.get(itemId) ?? itemId;
            return (
              <tr key={itemId} className="hover:bg-slate-50">
                <Td className="font-medium text-slate-900">{label}</Td>
                <Td>
                  <AvailabilityCell
                    itemLabel={label}
                    state={stateByItem.get(itemId)}
                    disabled={updateAvailability.isPending}
                    onChange={(status, soldOutUntil) =>
                      updateAvailability.mutate({ itemId, request: { status, soldOutUntil } })
                    }
                  />
                </Td>
              </tr>
            );
          })}
        </TBody>
      </Table>
      {itemIds.size === 0 && <p className="text-sm text-slate-500">No items yet for this venue.</p>}
    </div>
  );
}
