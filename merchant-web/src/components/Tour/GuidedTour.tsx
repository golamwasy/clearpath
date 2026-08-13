import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import { useTraceStream } from "../../lib/traceStream";
import { useLastWriteCorrelationId } from "../../lib/correlationTracking";
import { useTourObservations } from "../../lib/tourObservations";
import { currentStepIndex, deriveTourProgress, type TourStepId } from "../../lib/tourProgress";
import { useCurrentVenue } from "../../lib/venueSelection";
import { useVenueItems } from "../../api/queries/menu";
import { useTrace } from "../../api/queries/traces";

interface StepCopy {
  id: TourStepId;
  title: string;
  body: ReactNode;
  /** What the app must observe before this counts as done — stated up front, not just after. */
  gate: string;
  link: (venueId: string | null, lastWriteCorrelationId: string | null) => { to: string; label: string } | null;
}

const STEPS: StepCopy[] = [
  {
    id: "venue",
    title: "Set up a venue",
    body: (
      <>
        menu-service ships with an empty database. Creating a venue and a few items is four real
        writes — each one commits an item row and an outbox row in the same Postgres transaction.
      </>
    ),
    gate: "menu-service returns at least one item",
    link: (venueId) => (venueId ? { to: `/venues/${venueId}/menu`, label: "Open the menu" } : { to: "/venues/new", label: "Create a venue" }),
  },
  {
    id: "edit",
    title: "Change a price",
    body: (
      <>
        Click a price in the menu editor and change it. That is one optimistic-locked{" "}
        <span className="font-mono text-xs">PUT</span>, carrying a correlation ID this browser
        generated — the frontend is the true origin of the trace, so it mints the ID rather than
        leaving it to the first backend hop.
      </>
    ),
    gate: "an http.PUT span arrives on the stream",
    link: (venueId) => (venueId ? { to: `/venues/${venueId}/menu`, label: "Go to the menu editor" } : null),
  },
  {
    id: "propagate",
    title: "Watch it cross the system",
    body: (
      <>
        The write commits to Postgres with its outbox row, the relay publishes to{" "}
        <span className="font-mono text-xs">menu.events</span> only after the broker acks, and
        availability-service consumes it, checks its dedupe table and writes Redis. Every hop pulses
        as its span arrives.
      </>
    ),
    gate: "spans from 2+ services share your correlation ID",
    link: () => ({ to: "/system/flow", label: "Open the flow view" }),
  },
  {
    id: "trace",
    title: "Read the proof",
    body: (
      <>
        The full waterfall for that one correlation ID: every hop, its latency, its idempotency key.
        This is what "every request carries a correlation ID across HTTP and Kafka" looks like when
        you can actually inspect it.
      </>
    ),
    gate: "a trace is fetched from trace-collector",
    link: (_venueId, lastWriteCorrelationId) =>
      lastWriteCorrelationId
        ? { to: `/system/traces/${lastWriteCorrelationId}`, label: "Open your last trace" }
        : { to: "/system/traces", label: "Browse traces" },
  },
  {
    id: "chaos",
    title: "Break it, and watch it refuse to break",
    body: (
      <>
        Force a duplicate delivery. availability-service really re-processes the same event through
        the same idempotency-checked path — and rejects it, leaving item state untouched. Redelivery
        is a fact of Kafka; surviving it is the design.
      </>
    ),
    gate: "the replay is rejected and item state is unchanged",
    link: () => ({ to: "/system/chaos", label: "Open the chaos panel" }),
  },
];

/**
 * A five-step route through the six screens, in the order that tells the story.
 *
 * Each step completes on an observation, not a click — see `deriveTourProgress`. That makes the tour
 * double as a self-check: if Kafka is down, step 3 simply never turns green, and the demo tells the
 * truth about that instead of congratulating the operator.
 */
export function GuidedTour({ compact = false }: { compact?: boolean }) {
  const { venueId } = useCurrentVenue();
  const { data: items } = useVenueItems(venueId ?? "");
  const { spans } = useTraceStream();
  const lastWriteCorrelationId = useLastWriteCorrelationId();
  const { viewedTraceCorrelationIds, duplicateDelivery } = useTourObservations();

  // The live SSE buffer only holds what has arrived since this page loaded, so a reload would
  // silently un-tick steps 2 and 3 for a write that genuinely happened. Re-reading the last write's
  // trace from trace-collector — the authoritative record — restores them from server data rather
  // than from a cached "true" the frontend told itself.
  // Polled, because the trailing hops of a write (the Kafka consume, the Redis write) reach
  // trace-collector after the earlier ones — a single fetch can catch a trace mid-flight and would
  // otherwise leave step 3 reporting a propagation that had already completed.
  const { data: persistedSpans } = useTrace(lastWriteCorrelationId ?? "", { refetchIntervalMs: 3000 });

  const liveSpanIds = new Set(spans.map((span) => span.spanId));
  const mergedSpans = [...spans, ...(persistedSpans ?? []).filter((span) => !liveSpanIds.has(span.spanId))];

  const steps = deriveTourProgress({
    itemCount: items?.length ?? 0,
    lastWriteCorrelationId,
    spans: mergedSpans,
    viewedTraceCorrelationIds,
    duplicateDelivery,
  });

  const activeIndex = currentStepIndex(steps);
  const doneCount = steps.filter((step) => step.done).length;

  return (
    <section className="space-y-3" aria-labelledby="guided-tour-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="guided-tour-heading" className="text-sm font-semibold text-slate-900">
          See it work: a five-step tour
        </h2>
        <p className="text-xs text-slate-500">
          <span className="font-medium tabular-nums text-slate-700">{doneCount} of {steps.length}</span>{" "}
          — steps tick over when the system is observed doing the thing, not when you click
        </p>
      </div>

      <ol className={`grid gap-3 ${compact ? "grid-cols-1" : "grid-cols-1 md:grid-cols-2 xl:grid-cols-5"}`}>
        {STEPS.map((copy, index) => {
          const state = steps[index];
          const isActive = index === activeIndex;
          const link = copy.link(venueId, lastWriteCorrelationId);

          return (
            <li
              key={copy.id}
              aria-current={isActive ? "step" : undefined}
              data-testid={`tour-step-${copy.id}`}
              data-done={state.done}
              className={`flex flex-col gap-2 rounded-xl border p-4 transition-colors ${
                state.done
                  ? "border-green-200 bg-green-50/60"
                  : isActive
                    ? "border-blue-300 bg-white shadow-sm ring-1 ring-blue-200"
                    : "border-slate-200 bg-white/60"
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold ${
                    state.done ? "bg-green-600 text-white" : isActive ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-600"
                  }`}
                >
                  {state.done ? "✓" : index + 1}
                </span>
                <h3 className="text-sm font-semibold text-slate-900">{copy.title}</h3>
              </div>

              <p className="text-xs leading-relaxed text-slate-600">{copy.body}</p>

              {state.done ? (
                <p className="mt-auto text-[11px] font-medium text-green-800">✓ {state.detail}</p>
              ) : (
                <p className="mt-auto text-[11px] text-slate-400">waiting for: {copy.gate}</p>
              )}

              {link && !state.done && (
                <Link
                  to={link.to}
                  className={`text-xs font-medium ${isActive ? "text-blue-700 hover:underline" : "text-slate-500 hover:underline"}`}
                >
                  {link.label} →
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
