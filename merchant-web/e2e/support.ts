const MENU_API_URL = process.env.MENU_API_URL ?? "http://localhost:8081";

interface CreatedItem {
  venueId: string;
  itemId: string;
}

/**
 * Backend test fixture helper: creates a venue and one item directly against
 * menu-service's REST API. There is no venue-creation/venue-switcher UI (out
 * of scope per docs/plan-phase4.md section 7), so e2e specs seed their own
 * data through the real API rather than a UI flow that doesn't exist.
 */
export async function createVenueWithItem(itemName: string, priceCents: number): Promise<CreatedItem> {
  const venueRes = await fetch(`${MENU_API_URL}/venues`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: `e2e-venue-${Date.now()}` }),
  });
  if (!venueRes.ok) throw new Error(`Failed to create venue: ${venueRes.status}`);
  const venue = (await venueRes.json()) as { id: string; name: string };

  const itemRes = await fetch(`${MENU_API_URL}/venues/${venue.id}/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: itemName, priceCents, sortOrder: 0 }),
  });
  if (!itemRes.ok) throw new Error(`Failed to create item: ${itemRes.status}`);
  const item = (await itemRes.json()) as { id: string };

  return { venueId: venue.id, itemId: item.id };
}
