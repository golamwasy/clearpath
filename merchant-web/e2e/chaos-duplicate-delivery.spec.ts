import { test, expect } from "@playwright/test";
import { createVenueWithItem } from "./support";

// The chaos panel replays whatever menu.events record availability-service processed most
// recently (a global, not per-item, cache — see docs/adr/0005-observability-ui.md), so this
// test creates its own item immediately before firing the replay to keep the target
// deterministic, rather than assuming isolation from other concurrently-running specs.
test("forcing a duplicate delivery is rejected by the dedupe check and leaves item state unchanged", async ({
  page,
}) => {
  const { venueId } = await createVenueWithItem("Playwright Duplicate Item", 500);

  // Wait for the real create -> outbox -> menu.events -> availability-service consume path to
  // land this item in Redis as in_stock, so it's the record the chaos panel will replay.
  await page.goto(`/venues/${venueId}/availability`);
  await expect(page.getByText("Playwright Duplicate Item")).toBeVisible();
  // Target the cell's control, and allow real propagation time: this is waiting on an actual
  // Kafka round trip, so the default 5s assertion timeout is the wrong budget for it.
  await expect(page.getByRole("button", { name: "In stock" })).toBeVisible({ timeout: 15_000 });

  await page.goto("/system/chaos");
  await expect(page.getByRole("heading", { name: "Force a duplicate delivery" })).toBeVisible();

  await page.getByRole("button", { name: /fire duplicate delivery/i }).click();

  await expect(page.getByText("rejected", { exact: true })).toBeVisible();
  await expect(page.getByText("already processed")).toBeVisible();
  await expect(page.getByText("unchanged", { exact: true })).toBeVisible();

  // Server-side truth, not just the client cache: reload the availability screen and confirm
  // the replay really did nothing.
  await page.goto(`/venues/${venueId}/availability`);
  await expect(page.getByText("Playwright Duplicate Item")).toBeVisible();
  await expect(page.getByRole("button", { name: "In stock" })).toBeVisible({ timeout: 15_000 });
});
