import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ChaosPanel } from "./ChaosPanel";
import { TraceStreamProvider } from "../../lib/traceStream";
import type { AvailabilityState } from "../../api/queries/availability";

const VENUE_ID = import.meta.env.VITE_DEFAULT_VENUE_ID ?? "";

const item: AvailabilityState = {
  venueId: VENUE_ID,
  itemId: "item-1",
  status: "in_stock",
  soldOutUntil: null,
  version: 1,
  updatedAt: "2026-01-01T00:00:00Z",
};

class FakeEventSource {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  close() {}
}

function renderChaosPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TraceStreamProvider>
        <ChaosPanel />
      </TraceStreamProvider>
    </QueryClientProvider>,
  );
}

describe("ChaosPanel duplicate delivery", () => {
  beforeEach(() => {
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the replay as rejected and the item state unchanged", async () => {
    const user = userEvent.setup();
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;

    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (method === "GET" && url.includes("/chaos/state")) {
        if (url.includes(":8082")) {
          return jsonResponse(200, { consumerPaused: false, redisUnreachable: false });
        }
        return jsonResponse(200, { chaosEnabled: true, latencyMs: 0 });
      }
      if (method === "GET" && url.includes(`/venues/${VENUE_ID}/availability`)) {
        return jsonResponse(200, { items: [item] });
      }
      if (method === "POST" && url.includes("/chaos/duplicate-delivery")) {
        return jsonResponse(200, {
          eventId: "event-1",
          itemId: "item-1",
          correlationId: "corr-1",
          accepted: false,
          reason: "already processed",
        });
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    });

    renderChaosPanel();

    await screen.findByText("Force duplicate delivery (headline case)");
    await user.click(screen.getByRole("button", { name: /fire duplicate delivery/i }));

    await waitFor(() => expect(screen.getByText("rejected")).toBeInTheDocument());
    expect(screen.getByText("already processed", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("unchanged")).toBeInTheDocument();
  });
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
