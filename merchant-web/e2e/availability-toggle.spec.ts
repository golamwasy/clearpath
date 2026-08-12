import { test, expect } from "@playwright/test";
import { createVenueWithItem } from "./support";

test("toggling an item to sold out persists across a reload", async ({ page }) => {
  const { venueId } = await createVenueWithItem("Playwright Fries", 400);

  await page.goto(`/venues/${venueId}/availability`);
  await expect(page.getByText("Playwright Fries")).toBeVisible();
  await expect(page.getByText("In stock")).toBeVisible();

  await page.getByRole("button", { name: "In stock" }).click();
  await page.getByRole("button", { name: "Sold out" }).click();

  await expect(page.getByText("Sold out", { exact: true })).toBeVisible();

  // Reload — asserts the manual-override PUT round-tripped through
  // availability-service's Redis store, not just the client cache.
  await page.reload();

  await expect(page.getByText("Playwright Fries")).toBeVisible();
  await expect(page.getByText("Sold out", { exact: true })).toBeVisible();
});
