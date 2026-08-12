import { Button } from "../../components/ui/Button";
import { useRetrySyncRun } from "../../api/queries/syncRuns";

export function RetryButton({ runId }: { runId: string }) {
  const retry = useRetrySyncRun();

  return (
    <Button
      variant="secondary"
      onClick={() => retry.mutate(runId)}
      disabled={retry.isPending}
      aria-label={`Retry sync run ${runId}`}
    >
      {retry.isPending ? "Retrying…" : "Retry"}
    </Button>
  );
}
