import { Link } from "react-router-dom";
import { PageHeader } from "../../components/ui/PageHeader";
import { Table, THead, TBody, Th, Td } from "../../components/ui/Table";
import { Badge } from "../../components/ui/Badge";
import { Spinner } from "../../components/ui/Spinner";
import { InlineError } from "../../components/ui/InlineError";
import { useTraces } from "../../api/queries/traces";
import { SourceTag } from "../../components/ui/SourceTag";
import { InvariantBadge } from "../../components/ui/InvariantBadge";
import { EmptyState } from "../../components/ui/EmptyState";
import { formatDateTime } from "../../lib/format";

export function TraceList() {
  const { data: traces, isLoading, isError, error } = useTraces();

  if (isLoading) return <Spinner label="Loading traces" />;
  if (isError) return <InlineError>Failed to load traces: {(error as Error).message}</InlineError>;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Traces"
        subtitle={
          <>
            {(traces ?? []).length} recent traces. One row per correlation ID — every hop that ID
            touched, across services and across Kafka, grouped back together.{" "}
            <InvariantBadge n={3} />
          </>
        }
        source={<SourceTag origin="trace-collector · Mongo" freshness="on load" />}
      />
      <Table>
        <THead>
          <tr>
            <Th>Correlation ID</Th>
            <Th>Started</Th>
            <Th>Duration</Th>
            <Th>Spans</Th>
            <Th>Status</Th>
          </tr>
        </THead>
        <TBody>
          {(traces ?? []).map((trace) => (
            <tr key={trace.correlationId} className="hover:bg-slate-50">
              <Td className="font-mono text-xs">
                <Link className="text-blue-600 hover:underline" to={`/system/traces/${trace.correlationId}`}>
                  {trace.correlationId}
                </Link>
              </Td>
              <Td className="whitespace-nowrap text-slate-500">{formatDateTime(trace.startedAt)}</Td>
              <Td>{trace.durationMs}ms</Td>
              <Td>{trace.spanCount}</Td>
              <Td>
                <Badge tone={trace.status === "error" ? "danger" : "success"}>{trace.status}</Badge>
              </Td>
            </tr>
          ))}
        </TBody>
      </Table>
      {(traces ?? []).length === 0 && (
        <EmptyState
          title="trace-collector has consumed no spans"
          reason="Spans reach trace-collector over the system.trace Kafka topic. An empty list means no instrumented call has happened since the topic was last read — or that the consumer is not running."
          fills="Any menu edit produces a trace. Change a price and this list fills in well under a second."
        />
      )}
    </div>
  );
}
