import { describe, expect, it } from "vitest";
import { FlowEdgeMapper } from "./flowGraph";
import type { Span } from "./traceStream";

function makeSpan(overrides: Partial<Span> = {}): Span {
  return {
    correlationId: "corr-1",
    spanId: "span-1",
    parentSpanId: null,
    service: "menu-service",
    operation: "http.POST /venues/v1/items",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:00:00.050Z",
    durationMs: 50,
    status: "ok",
    error: null,
    root: true,
    idempotencyKey: null,
    kafkaPartition: null,
    retryCount: null,
    ...overrides,
  };
}

describe("FlowEdgeMapper", () => {
  it("maps an http span to a merchant-web edge plus the service's trace-collector edge", () => {
    const mapper = new FlowEdgeMapper();
    const edges = mapper.edgesForSpan(makeSpan());

    expect(edges).toHaveLength(2);
    expect(edges[0]).toMatchObject({ from: "merchant-web", to: "menu-service", latencyMs: 50 });
    expect(edges[1]).toMatchObject({ from: "menu-service", to: "trace-collector" });
  });

  it("pairs a kafka.publish menu.events span with the next matching kafka.consume span", () => {
    const mapper = new FlowEdgeMapper();
    // Eviction compares against the real clock, so these must be "now", not a fixed past date.
    const now = Date.now();

    mapper.edgesForSpan(
      makeSpan({
        spanId: "publish-1",
        service: "menu-service",
        operation: "kafka.publish menu.events",
        startedAt: new Date(now).toISOString(),
        finishedAt: new Date(now + 10).toISOString(),
      }),
    );

    const consumeEdges = mapper.edgesForSpan(
      makeSpan({
        spanId: "consume-1",
        service: "availability-service",
        operation: "kafka.consume menu.events",
        startedAt: new Date(now + 30).toISOString(),
        finishedAt: new Date(now + 40).toISOString(),
      }),
    );

    const kafkaEdge = consumeEdges.find((e) => e.key.endsWith("-kafka"));
    expect(kafkaEdge).toMatchObject({ from: "menu-service", to: "availability-service", latencyMs: 20 });
  });

  it("does not pair a consume span with no prior matching publish", () => {
    const mapper = new FlowEdgeMapper();
    const edges = mapper.edgesForSpan(
      makeSpan({ service: "availability-service", operation: "kafka.consume menu.events" }),
    );
    expect(edges.some((e) => e.key.endsWith("-kafka"))).toBe(false);
  });

  it("returns only the trace-collector edge for a span with no other mapping (e.g. db.commit)", () => {
    const mapper = new FlowEdgeMapper();
    const edges = mapper.edgesForSpan(
      makeSpan({ service: "availability-service", operation: "db.commit processed_events" }),
    );
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ from: "availability-service", to: "trace-collector" });
  });

  it("marks an error span's edges as error status", () => {
    const mapper = new FlowEdgeMapper();
    const edges = mapper.edgesForSpan(makeSpan({ status: "error", error: "boom" }));
    expect(edges.every((e) => e.status === "error")).toBe(true);
  });
});
