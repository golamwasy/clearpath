import { test, expect, type Page } from "@playwright/test";
import { createVenueWithItem } from "./support";

/**
 * Walks the whole five-step tour against a live stack, in the order a demo does.
 *
 * The point of the assertions below is not that the UI rendered — it is that each step only turns
 * green because the distributed system genuinely did the thing. Step 3 in particular cannot pass
 * unless a menu.events message really crossed Kafka into availability-service, so this spec doubles
 * as an end-to-end check of the write path itself.
 */

function step(page: Page, id: string) {
  return page.getByTestId(`tour-step-${id}`);
}

/**
 * A generous budget on purpose: these steps wait on a real write crossing Postgres, an outbox relay,
 * Kafka and a second service, plus the tour's own 3s poll of trace-collector. On a loaded machine
 * running the whole stack alongside several browsers, that is seconds of genuine work, not a render.
 * A tight timeout here fails the test for being slow rather than for being wrong.
 */
const PROPAGATION_TIMEOUT_MS = 45_000;

async function expectStepDone(page: Page, id: string) {
  await expect(step(page, id)).toHaveAttribute("data-done", "true", { timeout: PROPAGATION_TIMEOUT_MS });
}

test("the guided tour completes as the system is observed doing each step", async ({ page }) => {
  // Playwright's 30s default caps the whole test, which is shorter than the propagation budget the
  // individual steps need — this walk waits on five real round trips through the system, not on
  // rendering.
  test.setTimeout(180_000);
  const { venueId } = await createVenueWithItem("Tour Burger", 900);

  // Select the seeded venue the way the app does, then land on the overview.
  await page.goto(`/venues/${venueId}/menu`);
  await expect(page.getByText("Tour Burger")).toBeVisible();
  await page.goto("/");

  // Step 1 is satisfied by menu-service actually returning an item.
  await expectStepDone(page, "venue");
  // Nothing else can be true yet — no write has been made this session.
  await expect(step(page, "edit")).toHaveAttribute("data-done", "false");
  await expect(step(page, "propagate")).toHaveAttribute("data-done", "false");

  // Step 2: a real optimistic-locked PUT from the menu editor.
  await page.goto(`/venues/${venueId}/menu`);
  await page.getByText("$9.00").click();
  const input = page.getByLabel(/price for tour burger/i);
  await input.fill("13.40");
  // Wait for the write itself and assert it succeeded. Steps 3 and 4 are assertions about what the
  // system did with this PUT, so a silently-rejected one (a 409, say) would otherwise surface much
  // later as an inscrutable "step never completed".
  const [putResponse] = await Promise.all([
    page.waitForResponse((response) => response.request().method() === "PUT"),
    input.press("Tab"),
  ]);
  expect(putResponse.status(), "the price edit must be accepted for the later steps to mean anything").toBe(200);
  await expect(page.getByText("$13.40")).toBeVisible();

  await page.goto("/");
  await expectStepDone(page, "edit");

  // Step 3 is the real end-to-end assertion: it can only pass once spans from a second service
  // share this write's correlation ID, which requires the outbox relay to have published to
  // menu.events and availability-service to have consumed it.
  await expectStepDone(page, "propagate");
  await expect(step(page, "propagate")).toContainText("availability-service");

  // Step 4: the trace must actually come back from trace-collector.
  await page.getByRole("link", { name: /open your last trace/i }).click();
  await expect(page.getByRole("heading", { name: "Trace" })).toBeVisible();
  await expect(page.getByText("menu-service").first()).toBeVisible();

  await page.goto("/");
  await expectStepDone(page, "trace");

  // Step 5: availability-service must really reject the replayed event with state unchanged.
  await page.goto("/system/chaos");
  await page.getByRole("button", { name: /fire duplicate delivery/i }).click();
  await expect(page.getByText(/replayed/i)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("rejected", { exact: true })).toBeVisible();
  await expect(page.getByText("unchanged", { exact: true })).toBeVisible();

  await page.goto("/");
  await expectStepDone(page, "chaos");
  await expect(page.getByText("5 of 5")).toBeVisible();
});

test("a stack with no venue explains itself instead of rendering a blank page", async ({ page }) => {
  // The exact URL shape the old build produced when VITE_DEFAULT_VENUE_ID was unset, which is the
  // default in docker-compose. It used to match no route and paint an empty pane with no error.
  await page.goto("/venues//menu");

  await expect(page.getByRole("heading", { name: /a menu system that shows you/i })).toBeVisible();
});
