import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { PageHeader } from "../../components/ui/PageHeader";
import { Badge } from "../../components/ui/Badge";
import { Spinner } from "../../components/ui/Spinner";
import { InlineError } from "../../components/ui/InlineError";
import { useTrace, type Span } from "../../api/queries/traces";
import { recordTraceViewed } from "../../lib/tourObservations";

function fieldOrDash(value: string | number | null | undefined) {
  return value === null || value === undefined ? "—" : String(value);
}

export function TraceWaterfall() {
  const { correlationId = "" } = useParams<{ correlationId: string }>();
  // Same reason as the tour: a trace opened the instant a write is made is still filling in.
  const { data: spans, isLoading, isError, error } = useTrace(correlationId, { refetchIntervalMs: 3000 });
  const [expandedSpanId, setExpandedSpanId] = useState<string | null>(null);

  // Recorded only once trace-collector has actually returned spans for this correlation ID — the
  // tour's step 4 is gated on the fetch succeeding, not on the route being visited, so navigating
  // here while trace-collector is down correctly leaves the step incomplete.
  const traceLoaded = Boolean(spans && spans.length > 0);
  useEffect(() => {
    if (traceLoaded && correlationId) recordTraceViewed(correlationId);
  }, [traceLoaded, correlationId]);

  if (isLoading) return <Spinner label="Loading trace" />;
  if (isError) return <InlineError>Failed to load trace: {(error as Error).message}</InlineError>;
  if (!spans || spans.length === 0) return <InlineError>No spans found for this trace.</InlineError>;

  const traceStart = Math.min(...spans.map((s) => Date.parse(s.startedAt)));
  const traceEnd = Math.max(...spans.map((s) => Date.parse(s.finishedAt)));
  const totalDurationMs = Math.max(1, traceEnd - traceStart);
  const sorted = [...spans].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));

  return (
    <div className="space-y-6">
      <PageHeader title="Trace" subtitle={<span className="font-mono text-xs">{correlationId}</span>} />
      <div className="space-y-1 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        {sorted.map((span) => {
          const offsetMs = Date.parse(span.startedAt) - traceStart;
          const offsetPct = (offsetMs / totalDurationMs) * 100;
          const widthPct = Math.max(0.5, (span.durationMs / totalDurationMs) * 100);
          const isExpanded = expandedSpanId === span.spanId;

          return (
            <div key={span.spanId} className="border-b border-slate-50 py-2 last:border-b-0">
              <button
                type="button"
                onClick={() => setExpandedSpanId(isExpanded ? null : span.spanId)}
                className="grid w-full grid-cols-[140px_180px_1fr_80px] items-center gap-3 text-left text-sm"
              >
                <span className="truncate font-medium text-slate-900">{span.service}</span>
                <span className="truncate text-slate-600">{span.operation}</span>
                <span className="relative h-4 rounded bg-slate-100">
                  <span
                    className={`absolute h-4 rounded ${span.status === "error" ? "bg-red-500" : "bg-blue-500"}`}
                    style={{ left: `${offsetPct}%`, width: `${widthPct}%` }}
                  />
                </span>
                <span className="text-right text-slate-500">{span.durationMs}ms</span>
              </button>
              {isExpanded && (
                <div className="mt-2 space-y-2 rounded-md bg-slate-50 p-3">
                  <div className="grid grid-cols-3 gap-2 text-xs text-slate-600">
                    <div>
                      <span className="font-semibold">Idempotency key:</span> {fieldOrDash(span.idempotencyKey)}
                    </div>
                    <div>
                      <span className="font-semibold">Kafka partition:</span> {fieldOrDash(span.kafkaPartition)}
                    </div>
                    <div>
                      <span className="font-semibold">Retry count:</span> {fieldOrDash(span.retryCount)}
                    </div>
                  </div>
                  {span.status === "error" && (
                    <Badge tone="danger">{span.error ?? "error"}</Badge>
                  )}
                  <pre className="overflow-x-auto rounded bg-slate-900 p-3 text-xs text-slate-100">
                    {JSON.stringify(span satisfies Span, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
