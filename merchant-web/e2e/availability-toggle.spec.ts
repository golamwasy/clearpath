import { test, expect } from "@playwright/test";
import { createVenueWithItem } from "./support";

test("toggling an item to sold out persists across a reload", async ({ page }) => {
  const { venueId } = await createVenueWithItem("Playwright Fries", 400);

  await page.goto(`/venues/${venueId}/availability`);
  await expect(page.getByText("Playwright Fries")).toBeVisible();
  // Target the cell's own control rather than any text on the page: availability-service may not
  // have consumed the create event yet, and a looser text match can be satisfied by prose elsewhere
  // on the screen while the cell itself still reads as having no state.
  await expect(page.getByRole("button", { name: "In stock" })).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "In stock" }).click();
  // Wait for the override PUT itself, not just for the optimistic UI to flip — otherwise the reload
  // below can outrun the request it is meant to be verifying.
  await Promise.all([
    page.waitForResponse(
      (response) => response.request().method() === "PUT" && response.url().includes("/availability"),
    ),
    page.getByRole("button", { name: "Sold out" }).click(),
  ]);

  await expect(page.getByRole("button", { name: /sold out/i })).toBeVisible();

  // Reload — asserts the manual-override PUT round-tripped through
  // availability-service's Redis store, not just the client cache.
  await page.reload();

  await expect(page.getByText("Playwright Fries")).toBeVisible();
  await expect(page.getByRole("button", { name: /sold out/i })).toBeVisible();
});
