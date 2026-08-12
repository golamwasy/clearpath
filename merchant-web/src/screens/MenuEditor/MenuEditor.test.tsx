import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { MenuEditor } from "./MenuEditor";
import type { ItemResponse } from "../../api/queries/menu";

const VENUE_ID = "venue-1";

const baseItem: ItemResponse = {
  id: "item-1",
  venueId: VENUE_ID,
  categoryId: null,
  name: "Cheeseburger",
  description: null,
  priceCents: 900,
  sortOrder: 0,
  version: 1,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

function renderMenuEditor() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/venues/${VENUE_ID}/menu`]}>
        <Routes>
          <Route path="/venues/:venueId/menu" element={<MenuEditor />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("MenuEditor conflict handling", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the server's current name/price on a 409 and clears it without looping on the next edit", async () => {
    const user = userEvent.setup();
    const serverCurrent: ItemResponse = {
      ...baseItem,
      name: "Deluxe Cheeseburger",
      priceCents: 1200,
      version: 2,
    };

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (method === "GET" && url.includes(`/venues/${VENUE_ID}/items`)) {
        return jsonResponse(200, [baseItem]);
      }

      if (method === "PUT" && url.includes(`/items/${baseItem.id}`)) {
        const body = JSON.parse(init!.body as string);
        if (body.version === baseItem.version) {
          // First edit races against the server's newer state -> 409 with `current`.
          return jsonResponse(409, {
            error: "version_conflict",
            message: "Item was modified concurrently",
            current: serverCurrent,
          });
        }
        // Second edit, now carrying the acknowledged version -> succeeds.
        return jsonResponse(200, { ...serverCurrent, ...body, version: body.version + 1 });
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    });

    renderMenuEditor();

    await screen.findByText("Cheeseburger");

    // Trigger an inline price edit that will conflict.
    await user.click(screen.getByText("$9.00"));
    const input = screen.getByLabelText(/price for cheeseburger/i);
    await user.clear(input);
    await user.type(input, "10.00");
    await user.tab();

    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent("Deluxe Cheeseburger");
    expect(banner).toHaveTextContent("$12.00");

    // Acknowledge — pulls the server's current values/version into the cache.
    await user.click(screen.getByRole("button", { name: /use latest values/i }));

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(await screen.findByText("Deluxe Cheeseburger")).toBeInTheDocument();

    // Retry the edit — should now carry version 2, not re-conflict.
    await user.click(screen.getByText("$12.00"));
    const retryInput = screen.getByLabelText(/price for deluxe cheeseburger/i);
    await user.clear(retryInput);
    await user.type(retryInput, "13.00");
    await user.tab();

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(await screen.findByText("$13.00")).toBeInTheDocument();
  });
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
