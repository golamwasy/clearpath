import { Link } from "react-router-dom";
import { PageHeader } from "../../components/ui/PageHeader";
import { Table, THead, TBody, Th, Td } from "../../components/ui/Table";
import { Badge } from "../../components/ui/Badge";
import { Spinner } from "../../components/ui/Spinner";
import { InlineError } from "../../components/ui/InlineError";
import { useTraces } from "../../api/queries/traces";
import { formatDateTime } from "../../lib/format";

export function TraceList() {
  const { data: traces, isLoading, isError, error } = useTraces();

  if (isLoading) return <Spinner label="Loading traces" />;
  if (isError) return <InlineError>Failed to load traces: {(error as Error).message}</InlineError>;

  return (
    <div className="space-y-6">
      <PageHeader title="Traces" subtitle={`${(traces ?? []).length} recent traces from trace-collector`} />
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
      {(traces ?? []).length === 0 && <p className="text-sm text-slate-500">No traces yet.</p>}
    </div>
  );
}
