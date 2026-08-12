import { Table, THead, TBody, Th, Td } from "../../components/ui/Table";
import { PageHeader } from "../../components/ui/PageHeader";
import { Badge } from "../../components/ui/Badge";
import { InlineError } from "../../components/ui/InlineError";
import { Spinner } from "../../components/ui/Spinner";
import { RetryButton } from "./RetryButton";
import { useSyncRuns } from "../../api/queries/syncRuns";
import { formatDateTime } from "../../lib/format";
import type { SyncRun } from "../../api/queries/syncRuns";

export function SyncStatus() {
  const { data: runs, isLoading, isError, error } = useSyncRuns();

  if (isLoading) return <Spinner label="Loading sync runs" />;

  if (isError) {
    return <InlineError>Failed to load sync runs: {(error as Error).message}</InlineError>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sync status"
        subtitle={`${(runs ?? []).length} recent ${(runs ?? []).length === 1 ? "run" : "runs"} from pos-ingest`}
      />
      <Table>
        <THead>
          <tr>
            <Th>Venue</Th>
            <Th>Provider</Th>
            <Th>Status</Th>
            <Th>Items changed</Th>
            <Th>Started</Th>
            <Th>Finished</Th>
            <Th>Error</Th>
            <Th>Retry</Th>
          </tr>
        </THead>
        <TBody>
          {(runs ?? []).map((run) => (
            <tr key={run.ID} className="hover:bg-slate-50">
              <Td className="font-medium text-slate-900">{run.VenueID}</Td>
              <Td>{run.Provider}</Td>
              <Td>
                <StatusBadge status={run.Status} />
              </Td>
              <Td>{run.ItemsChanged}</Td>
              <Td className="whitespace-nowrap text-slate-500">{formatDateTime(run.StartedAt)}</Td>
              <Td className="whitespace-nowrap text-slate-500">{formatDateTime(run.FinishedAt)}</Td>
              <Td className="max-w-xs truncate text-red-700" title={run.Error ?? undefined}>
                {run.Error ?? "—"}
              </Td>
              <Td>
                <RetryButton runId={run.ID} />
              </Td>
            </tr>
          ))}
        </TBody>
      </Table>
      {(runs ?? []).length === 0 && <p className="text-sm text-slate-500">No sync runs yet.</p>}
    </div>
  );
}

function StatusBadge({ status }: { status: SyncRun["Status"] }) {
  if (status === "success") return <Badge tone="success">Success</Badge>;
  if (status === "failed") return <Badge tone="danger">Failed</Badge>;
  return <Badge tone="neutral">Running</Badge>;
}
