const INVARIANTS = {
  1: {
    short: "outbox",
    full: "A Postgres write and a Kafka publish never diverge. The item row and its outbox row commit in one transaction; the relay publishes only after that commit.",
  },
  2: {
    short: "idempotent",
    full: "Every consumer is idempotent, keyed on a dedupe key in its own store. Reprocessing the same message is a no-op.",
  },
  3: {
    short: "correlation ID",
    full: "Every request carries a correlation ID, propagated across HTTP and Kafka headers — including from this browser, which mints it.",
  },
  4: {
    short: "eventual vs real-time",
    full: "Menu data is eventually consistent; availability data is near real time. The UI must not blur the two — which is why an item availability-service has no state for yet is shown as having none, rather than being presented as on sale.",
  },
} as const;

export type InvariantNumber = keyof typeof INVARIANTS;

/**
 * Marks the one UI element that demonstrates a given non-negotiable invariant from CLAUDE.md. The
 * numbering is real — it maps to that list, not to a decorative sequence.
 *
 * This is what makes a viewer read the grey "Unknown" availability badge as a deliberate correctness
 * decision rather than a missing value: without the marker, the most principled thing on the screen
 * looks like the least finished one.
 */
export function InvariantBadge({ n }: { n: InvariantNumber }) {
  const invariant = INVARIANTS[n];
  return (
    <span
      title={`Invariant ${n}: ${invariant.full}`}
      className="inline-flex cursor-help items-center gap-1 rounded border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700"
    >
      <span aria-hidden="true">inv {n}</span>
      <span className="font-normal normal-case tracking-normal">{invariant.short}</span>
      <span className="sr-only">
        Invariant {n}: {invariant.full}
      </span>
    </span>
  );
}
