import { test, expect } from "@playwright/test";
import { createVenueWithItem } from "./support";

test("editing a price inline persists across a reload", async ({ page }) => {
  const { venueId } = await createVenueWithItem("Playwright Burger", 850);

  await page.goto(`/venues/${venueId}/menu`);
  await expect(page.getByText("Playwright Burger")).toBeVisible();

  await page.getByText("$8.50").click();
  const input = page.getByLabel(/price for playwright burger/i);
  await input.fill("11.25");
  await input.press("Tab");

  await expect(page.getByText("$11.25")).toBeVisible();

  // Reload — this is the assertion that matters: the new price round-tripped
  // through menu-service's Postgres, not just the client-side query cache.
  await page.reload();

  await expect(page.getByText("Playwright Burger")).toBeVisible();
  await expect(page.getByText("$11.25")).toBeVisible();
});
