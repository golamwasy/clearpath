import type { Span } from "./traceStream";

export type TourStepId = "venue" | "edit" | "propagate" | "trace" | "chaos";

export interface TourInput {
  /** Items in the currently selected venue, from menu-service. */
  itemCount: number;
  /** Correlation ID of the most recent write this app made, if any. */
  lastWriteCorrelationId: string | null;
  /** Spans seen live on trace-collector's SSE stream this session. */
  spans: Span[];
  /** Correlation IDs whose full trace has actually been fetched and rendered. */
  viewedTraceCorrelationIds: readonly string[];
  /** The real response from availability-service's forced duplicate delivery, once fired. */
  duplicateDelivery: { accepted: boolean; stateUnchanged: boolean } | null;
}

export interface TourStepState {
  id: TourStepId;
  done: boolean;
  /** What the app actually observed, shown once done — never a generic "complete". */
  detail: string | null;
}

/**
 * How many distinct services must have emitted spans under one correlation ID before we call the
 * write "propagated". Two is the meaningful threshold: menu-service alone proves only that the HTTP
 * request was served, whereas a second service appearing means the event genuinely crossed Kafka.
 */
const PROPAGATION_SERVICE_THRESHOLD = 2;

/**
 * Derives tour progress from what the system has actually been observed doing.
 *
 * Every gate below is an observation, never a record of a click: step 3 needs spans from two
 * different services to have physically arrived on the SSE stream, step 4 needs a trace to have been
 * fetched from trace-collector, step 5 needs availability-service to have really rejected a replayed
 * event with item state unchanged. A tour that advanced on "user pressed Next" would be exactly the
 * fabricated liveness this project exists to argue against — and it would happily report success on
 * a stack where Kafka was down.
 *
 * Kept as a pure function over its inputs so this logic is testable without a browser, a backend, or
 * a rendered component — the same reason `flowGraph.ts` splits its edge mapping out of the diagram.
 */
export function deriveTourProgress(input: TourInput): TourStepState[] {
  const { itemCount, lastWriteCorrelationId, spans, viewedTraceCorrelationIds, duplicateDelivery } = input;

  const venueDone = itemCount > 0;

  const spansForLastWrite = lastWriteCorrelationId
    ? spans.filter((span) => span.correlationId === lastWriteCorrelationId)
    : [];

  // A price edit is a PUT. Creating the venue and its seed items are POSTs, so this can't be
  // satisfied by setup alone. Restricted to this operator's own correlation ID: the SSE stream
  // carries every service's traffic, including other browsers and load tests, so matching any
  // http.PUT anywhere would let somebody else's write tick off your step.
  const editSpan = spansForLastWrite.find((span) => span.operation.startsWith("http.PUT"));
  const servicesForLastWrite = new Set(spansForLastWrite.map((span) => span.service));
  const propagateDone = servicesForLastWrite.size >= PROPAGATION_SERVICE_THRESHOLD;

  const traceDone = viewedTraceCorrelationIds.length > 0;

  // Both halves matter: the replay must have been rejected AND the item must be unchanged. A
  // rejected replay that still mutated state would be a failed idempotency guarantee, not a passed
  // one, so this deliberately does not treat `accepted === false` alone as success.
  const chaosDone = duplicateDelivery !== null && !duplicateDelivery.accepted && duplicateDelivery.stateUnchanged;

  return [
    {
      id: "venue",
      done: venueDone,
      detail: venueDone ? `${itemCount} ${itemCount === 1 ? "item" : "items"} in menu-service` : null,
    },
    {
      id: "edit",
      done: Boolean(editSpan),
      detail: editSpan ? `observed ${editSpan.operation}` : null,
    },
    {
      id: "propagate",
      done: propagateDone,
      detail: propagateDone
        ? `${spansForLastWrite.length} spans across ${servicesForLastWrite.size} services: ${[...servicesForLastWrite].join(", ")}`
        : null,
    },
    {
      id: "trace",
      done: traceDone,
      detail: traceDone ? `${viewedTraceCorrelationIds.length} trace(s) opened` : null,
    },
    {
      id: "chaos",
      done: chaosDone,
      detail: chaosDone ? "replay rejected by the dedupe check, item state unchanged" : null,
    },
  ];
}

/** Index of the first incomplete step, or -1 when every step is done. */
export function currentStepIndex(steps: TourStepState[]): number {
  return steps.findIndex((step) => !step.done);
}
