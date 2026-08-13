import { describe, expect, it } from "vitest";
import { currentStepIndex, deriveTourProgress, type TourInput } from "./tourProgress";
import type { Span } from "./traceStream";

function makeSpan(overrides: Partial<Span> = {}): Span {
  return {
    correlationId: "corr-1",
    spanId: "span-1",
    parentSpanId: null,
    service: "menu-service",
    operation: "http.PUT /venues/v1/items/i1",
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

function makeInput(overrides: Partial<TourInput> = {}): TourInput {
  return {
    itemCount: 0,
    lastWriteCorrelationId: null,
    spans: [],
    viewedTraceCorrelationIds: [],
    duplicateDelivery: null,
    ...overrides,
  };
}

function stepById(input: TourInput, id: string) {
  const step = deriveTourProgress(input).find((s) => s.id === id);
  if (!step) throw new Error(`no step ${id}`);
  return step;
}

describe("deriveTourProgress", () => {
  it("starts with nothing complete on a fresh stack", () => {
    const steps = deriveTourProgress(makeInput());
    expect(steps.every((step) => !step.done)).toBe(true);
    expect(currentStepIndex(steps)).toBe(0);
  });

  it("completes the venue step once menu-service actually returns items", () => {
    expect(stepById(makeInput({ itemCount: 0 }), "venue").done).toBe(false);
    const done = stepById(makeInput({ itemCount: 3 }), "venue");
    expect(done.done).toBe(true);
    expect(done.detail).toBe("3 items in menu-service");
  });

  // The whole design premise: a step reflects an observation, so it must not be satisfiable by
  // navigation or clicking alone. Setup writes are POSTs, so seeding a venue cannot tick step 2.
  it("does not count the venue-setup POSTs as the price edit", () => {
    const setupSpans = [
      makeSpan({ spanId: "a", operation: "http.POST /venues" }),
      makeSpan({ spanId: "b", operation: "http.POST /venues/v1/items" }),
    ];
    expect(
      stepById(makeInput({ itemCount: 3, lastWriteCorrelationId: "corr-1", spans: setupSpans }), "edit").done,
    ).toBe(false);
  });

  it("completes the edit step on a real http.PUT span, and names the operation it saw", () => {
    const step = stepById(
      makeInput({ lastWriteCorrelationId: "corr-1", spans: [makeSpan()] }),
      "edit",
    );
    expect(step.done).toBe(true);
    expect(step.detail).toBe("observed http.PUT /venues/v1/items/i1");
  });

  // The SSE stream carries every service's traffic — other browsers, k6, a second demo tab. A gate
  // that matched any http.PUT anywhere would let someone else's write tick off your step.
  it("ignores an http.PUT made under a different correlation ID", () => {
    const step = stepById(
      makeInput({
        lastWriteCorrelationId: "corr-mine",
        spans: [makeSpan({ correlationId: "corr-somebody-else" })],
      }),
      "edit",
    );
    expect(step.done).toBe(false);
  });

  // One service's spans prove the HTTP request was served, not that anything crossed Kafka. If the
  // broker were down, menu-service would still emit its own spans — so a single-service threshold
  // would report a successful propagation on a system that had not propagated anything.
  it("does not call a write propagated when only one service emitted spans", () => {
    const step = stepById(
      makeInput({
        lastWriteCorrelationId: "corr-1",
        spans: [
          makeSpan({ spanId: "a", service: "menu-service", operation: "http.PUT /x" }),
          makeSpan({ spanId: "b", service: "menu-service", operation: "db.commit items" }),
        ],
      }),
      "propagate",
    );
    expect(step.done).toBe(false);
  });

  it("completes the propagate step when a second service picks up the same correlation ID", () => {
    const step = stepById(
      makeInput({
        lastWriteCorrelationId: "corr-1",
        spans: [
          makeSpan({ spanId: "a", service: "menu-service" }),
          makeSpan({ spanId: "b", service: "availability-service", operation: "kafka.consume menu.events" }),
        ],
      }),
      "propagate",
    );
    expect(step.done).toBe(true);
    expect(step.detail).toContain("2 services");
    expect(step.detail).toContain("availability-service");
  });

  it("ignores spans belonging to a different correlation ID", () => {
    const step = stepById(
      makeInput({
        lastWriteCorrelationId: "corr-1",
        spans: [
          makeSpan({ spanId: "a", correlationId: "corr-1", service: "menu-service" }),
          makeSpan({ spanId: "b", correlationId: "corr-OTHER", service: "availability-service" }),
        ],
      }),
      "propagate",
    );
    expect(step.done).toBe(false);
  });

  it("completes the trace step only once a trace has actually been fetched", () => {
    expect(stepById(makeInput(), "trace").done).toBe(false);
    expect(stepById(makeInput({ viewedTraceCorrelationIds: ["corr-1"] }), "trace").done).toBe(true);
  });

  describe("the chaos step", () => {
    it("is incomplete until a duplicate delivery has been fired", () => {
      expect(stepById(makeInput(), "chaos").done).toBe(false);
    });

    it("completes when the replay is rejected and item state is unchanged", () => {
      const step = stepById(
        makeInput({ duplicateDelivery: { accepted: false, stateUnchanged: true } }),
        "chaos",
      );
      expect(step.done).toBe(true);
    });

    // An accepted replay means the dedupe check let a duplicate through — the opposite of the
    // guarantee this step exists to demonstrate.
    it("stays incomplete when the replay was accepted", () => {
      expect(
        stepById(makeInput({ duplicateDelivery: { accepted: true, stateUnchanged: true } }), "chaos").done,
      ).toBe(false);
    });

    // A rejected replay that still moved item state would be a broken guarantee reported as a
    // passing one, which is the single most misleading thing this screen could do.
    it("stays incomplete when item state changed despite the rejection", () => {
      expect(
        stepById(makeInput({ duplicateDelivery: { accepted: false, stateUnchanged: false } }), "chaos").done,
      ).toBe(false);
    });
  });

  it("reports the first incomplete step as the current one, and -1 when all are done", () => {
    const partial = deriveTourProgress(makeInput({ itemCount: 2 }));
    expect(currentStepIndex(partial)).toBe(1);

    const all = deriveTourProgress(
      makeInput({
        itemCount: 2,
        lastWriteCorrelationId: "corr-1",
        spans: [
          makeSpan({ spanId: "a", service: "menu-service" }),
          makeSpan({ spanId: "b", service: "availability-service", operation: "redis.write availability" }),
        ],
        viewedTraceCorrelationIds: ["corr-1"],
        duplicateDelivery: { accepted: false, stateUnchanged: true },
      }),
    );
    expect(all.every((step) => step.done)).toBe(true);
    expect(currentStepIndex(all)).toBe(-1);
  });
});
