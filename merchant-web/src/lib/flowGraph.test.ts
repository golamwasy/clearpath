import { describe, expect, it } from "vitest";
import { FLOW_EDGES, FlowEdgeMapper, edgeFor, nodeById } from "./flowGraph";
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
    expect(kafkaEdge).toMatchObject({
      from: "kafka-menu-events",
      to: "availability-service",
      latencyMs: 20,
      latencyLabel: "publish→consume gap",
    });
  });

  // An unpaired consume still happened — only the publish→consume gap is unknowable. Dropping the
  // edge entirely would make a chaos-panel replay (which consumes a record whose publish span is
  // long gone) look like nothing reached availability-service at all.
  it("still draws the kafka hop for a consume with no prior publish, labelled as its own duration", () => {
    const mapper = new FlowEdgeMapper();
    const edges = mapper.edgesForSpan(
      makeSpan({ service: "availability-service", operation: "kafka.consume menu.events" }),
    );
    const kafkaEdge = edges.find((e) => e.key.endsWith("-kafka"));
    expect(kafkaEdge).toMatchObject({
      from: "kafka-menu-events",
      to: "availability-service",
      latencyLabel: "consume duration",
    });
  });

  // The six spans a real write actually produces, verified against a live docker-compose stack.
  // Each must land on its own drawn edge, or the diagram is showing less than the system does.
  it.each([
    ["menu-service", "db.commit items", "menu-service", "postgres-menu"],
    ["menu-service", "kafka.publish menu.events", "postgres-menu", "kafka-menu-events"],
    ["availability-service", "db.commit processed_events", "availability-service", "postgres-dedupe"],
    ["availability-service", "redis.write availability", "availability-service", "redis"],
    ["pos-ingest", "db.commit sync_runs", "pos-ingest", "postgres-sync"],
    ["pos-ingest", "kafka.publish pos.sync", "pos-ingest", "kafka-pos-sync"],
  ])("maps %s's %s span to the %s → %s edge", (service, operation, from, to) => {
    const mapper = new FlowEdgeMapper();
    const edges = mapper.edgesForSpan(makeSpan({ service, operation }));

    expect(edges.some((e) => e.from === from && e.to === to)).toBe(true);
    // Always accompanied by the span's own arrival at trace-collector, never instead of it.
    expect(edges.some((e) => e.to === "trace-collector")).toBe(true);
  });

  // storefront-api sends no CORS headers, so this browser cannot call it — an inbound HTTP span on
  // it came from k6 or curl. Attributing it to merchant-web would credit this page with a request
  // it is structurally incapable of making.
  it("attributes storefront-api's inbound http span to an external client, not merchant-web", () => {
    const mapper = new FlowEdgeMapper();
    const edges = mapper.edgesForSpan(
      makeSpan({ service: "storefront-api", operation: "http.GET /venues/v1/menu" }),
    );
    expect(edges.some((e) => e.from === "external-client" && e.to === "storefront-api")).toBe(true);
    expect(edges.some((e) => e.from === "merchant-web")).toBe(false);
  });

  it("emits no edge trace-collector points at itself", () => {
    const mapper = new FlowEdgeMapper();
    const edges = mapper.edgesForSpan(
      makeSpan({ service: "trace-collector", operation: "http.GET /traces" }),
    );
    expect(edges.some((e) => e.from === "trace-collector" && e.to === "trace-collector")).toBe(false);
  });

  it("marks an error span's edges as error status", () => {
    const mapper = new FlowEdgeMapper();
    const edges = mapper.edgesForSpan(makeSpan({ status: "error", error: "boom" }));
    expect(edges.every((e) => e.status === "error")).toBe(true);
  });
});

describe("flow graph shape", () => {
  it("declares both endpoints of every edge as a node", () => {
    for (const edge of FLOW_EDGES) {
      expect(() => nodeById(edge.from)).not.toThrow();
      expect(() => nodeById(edge.to)).not.toThrow();
    }
  });

  it("has a drawn edge for every hop the mapper can emit", () => {
    const mapper = new FlowEdgeMapper();
    const operations: Array<[string, string]> = [
      ["menu-service", "http.PUT /venues/v1/items/i1"],
      ["menu-service", "db.commit items"],
      ["menu-service", "kafka.publish menu.events"],
      ["availability-service", "kafka.consume menu.events"],
      ["availability-service", "db.commit processed_events"],
      ["availability-service", "redis.write availability"],
      ["availability-service", "http.GET /venues/v1/availability"],
      ["pos-ingest", "http.GET /sync-runs"],
      ["pos-ingest", "db.commit sync_runs"],
      ["pos-ingest", "kafka.publish pos.sync"],
      ["storefront-api", "http.GET /venues/v1/menu"],
    ];

    for (const [service, operation] of operations) {
      for (const edge of mapper.edgesForSpan(makeSpan({ service, operation }))) {
        expect(edgeFor(edge.from, edge.to), `no drawn edge for ${edge.from} → ${edge.to}`).toBeDefined();
      }
    }
  });

  // Uninstrumented hops are drawn dashed and captioned as never pulsing. If the mapper ever starts
  // emitting one, that caption becomes a lie — this catches it at test time rather than in a demo.
  it("never pulses an edge marked uninstrumented", () => {
    const mapper = new FlowEdgeMapper();
    const uninstrumented = new Set(FLOW_EDGES.filter((e) => !e.instrumented).map((e) => e.id));
    expect(uninstrumented.size).toBeGreaterThan(0);

    for (const [service, operation] of [
      ["availability-service", "redis.write availability"],
      ["availability-service", "db.commit processed_events"],
      ["storefront-api", "http.GET /venues/v1/menu"],
      ["menu-service", "db.commit items"],
    ] as Array<[string, string]>) {
      for (const edge of mapper.edgesForSpan(makeSpan({ service, operation }))) {
        expect(uninstrumented.has(edgeFor(edge.from, edge.to)?.id ?? "")).toBe(false);
      }
    }
  });
});
