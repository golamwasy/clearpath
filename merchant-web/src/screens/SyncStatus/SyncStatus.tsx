import { Table, THead, TBody, Th, Td } from "../../components/ui/Table";
import { PageHeader } from "../../components/ui/PageHeader";
import { Badge } from "../../components/ui/Badge";
import { InlineError } from "../../components/ui/InlineError";
import { Spinner } from "../../components/ui/Spinner";
import { RetryButton } from "./RetryButton";
import { SourceTag } from "../../components/ui/SourceTag";
import { EmptyState } from "../../components/ui/EmptyState";
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
        title="POS sync status"
        subtitle={
          <>
            {(runs ?? []).length} recent {(runs ?? []).length === 1 ? "run" : "runs"}. pos-ingest polls
            two deliberately mismatched mock POS providers on a timer — nested JSON with integer cents
            and string IDs, and a flat array with decimal-string prices — and normalizes both into one
            internal schema. Failures here are real: retries use exponential backoff with jitter, and
            exhausted retries go to pos.sync.dlq.
          </>
        }
        source={<SourceTag origin="pos-ingest · Postgres" freshness="polled" />}
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
      {(runs ?? []).length === 0 && (
        <EmptyState
          title="pos-ingest has not recorded a poll yet"
          reason="Every venue poll writes a sync_runs row to pos-ingest's own Postgres database. An empty table means the worker pool has not completed a cycle since startup."
          fills="Runs appear on their own within a poll interval — no action needed. If they never appear, check pos-ingest and its mock providers in the service panel on Start here."
        />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: SyncRun["Status"] }) {
  if (status === "success") return <Badge tone="success">Success</Badge>;
  if (status === "failed") return <Badge tone="danger">Failed</Badge>;
  return <Badge tone="neutral">Running</Badge>;
}
