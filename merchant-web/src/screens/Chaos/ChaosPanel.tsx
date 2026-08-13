import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "../../components/ui/PageHeader";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { InlineError } from "../../components/ui/InlineError";
import { ApiError } from "../../api/client";
import { useTraceStream } from "../../lib/traceStream";
import {
  useAvailabilityChaosState,
  usePosChaosState,
  usePauseConsumer,
  useResumeConsumer,
  useBreakRedis,
  useRestoreRedis,
  useDuplicateDelivery,
  useSetPosLatency,
  isChaosDisabled,
  type DuplicateDeliveryResponse,
} from "../../api/queries/chaos";
import {
  availabilityQueryKey,
  useVenueAvailability,
  type AvailabilityResponse,
  type AvailabilityState,
} from "../../api/queries/availability";

const DEFAULT_VENUE_ID = import.meta.env.VITE_DEFAULT_VENUE_ID ?? "";
const LATENCY_PRESET_MS = 3000;

function ChaosDisabledNotice({ service }: { service: string }) {
  return <InlineError>Chaos endpoints disabled on {service} (CHAOS_ENABLED=false).</InlineError>;
}

function isRecordWithReason(body: unknown): body is { reason: string } {
  return typeof body === "object" && body !== null && typeof (body as { reason?: unknown }).reason === "string";
}

export function ChaosPanel() {
  const availabilityChaos = useAvailabilityChaosState();
  const posChaos = usePosChaosState();
  const pauseConsumer = usePauseConsumer();
  const resumeConsumer = useResumeConsumer();
  const breakRedis = useBreakRedis();
  const restoreRedis = useRestoreRedis();
  const setPosLatency = useSetPosLatency();
  const duplicateDelivery = useDuplicateDelivery(DEFAULT_VENUE_ID);
  const queryClient = useQueryClient();
  const { spans } = useTraceStream();
  // Mounted so there's an active observer to snapshot before/after against — not rendered
  // directly, this screen only shows the diff for the one item the replay touched.
  const availability = useVenueAvailability(DEFAULT_VENUE_ID);

  const [duplicateResult, setDuplicateResult] = useState<{
    response: DuplicateDeliveryResponse;
    beforeItem?: AvailabilityState;
    afterItem?: AvailabilityState;
  } | null>(null);
  const [duplicateDeliveryError, setDuplicateDeliveryError] = useState<string | null>(null);

  async function fireDuplicateDelivery() {
    setDuplicateDeliveryError(null);
    try {
      const beforeItems = availability.data?.items ?? [];
      const response = await duplicateDelivery.mutateAsync();
      await queryClient.refetchQueries({ queryKey: availabilityQueryKey(DEFAULT_VENUE_ID) });
      const afterItems =
        queryClient.getQueryData<AvailabilityResponse>(availabilityQueryKey(DEFAULT_VENUE_ID))?.items ?? [];
      setDuplicateResult({
        response,
        beforeItem: beforeItems.find((i) => i.itemId === response.itemId),
        afterItem: afterItems.find((i) => i.itemId === response.itemId),
      });
    } catch (e) {
      // The 404 case (nothing processed yet this run) comes back with a structured
      // `{ reason: "..." }` body worth showing verbatim — e.message would just be the generic
      // "Request failed with status 404" ApiError's constructor defaults to.
      const reason = e instanceof ApiError && isRecordWithReason(e.body) ? e.body.reason : undefined;
      setDuplicateDeliveryError(reason ?? (e instanceof Error ? e.message : "Failed to fire duplicate delivery"));
    }
  }

  const replaySpans = duplicateResult?.response.correlationId
    ? spans.filter((s) => s.correlationId === duplicateResult.response.correlationId)
    : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Chaos panel"
        subtitle="Backend-real fault injection, guarded by CHAOS_ENABLED. Nothing here is simulated in the UI."
      />

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Pause menu.events consumer</h2>
        {isChaosDisabled(availabilityChaos.error) ? (
          <ChaosDisabledNotice service="availability-service" />
        ) : (
          <>
            <p className="text-sm text-slate-500">
              Current: <Badge tone={availabilityChaos.data?.consumerPaused ? "warning" : "success"}>
                {availabilityChaos.data?.consumerPaused ? "paused" : "running"}
              </Badge>{" "}
              — watch consumer lag climb on the flow view while paused.
            </p>
            <div className="flex gap-2">
              <Button onClick={() => pauseConsumer.mutate()} disabled={pauseConsumer.isPending}>
                Pause
              </Button>
              <Button onClick={() => resumeConsumer.mutate()} disabled={resumeConsumer.isPending}>
                Resume
              </Button>
            </div>
          </>
        )}
      </section>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Break Redis</h2>
        {isChaosDisabled(availabilityChaos.error) ? (
          <ChaosDisabledNotice service="availability-service" />
        ) : (
          <>
            <p className="text-sm text-slate-500">
              Current: <Badge tone={availabilityChaos.data?.redisUnreachable ? "danger" : "success"}>
                {availabilityChaos.data?.redisUnreachable ? "unreachable" : "reachable"}
              </Badge>{" "}
              — the Availability screen's reads/writes will error while broken.
            </p>
            <div className="flex gap-2">
              <Button variant="danger" onClick={() => breakRedis.mutate()} disabled={breakRedis.isPending}>
                Break
              </Button>
              <Button onClick={() => restoreRedis.mutate()} disabled={restoreRedis.isPending}>
                Restore
              </Button>
            </div>
          </>
        )}
      </section>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Inject pos-ingest latency</h2>
        {isChaosDisabled(posChaos.error) ? (
          <ChaosDisabledNotice service="pos-ingest" />
        ) : (
          <>
            <p className="text-sm text-slate-500">
              Current: <Badge tone={(posChaos.data?.latencyMs ?? 0) > 0 ? "warning" : "success"}>
                {posChaos.data?.latencyMs ?? 0}ms
              </Badge>{" "}
              delay before each venue poll.
            </p>
            <div className="flex gap-2">
              <Button onClick={() => setPosLatency.mutate(LATENCY_PRESET_MS)} disabled={setPosLatency.isPending}>
                Inject {LATENCY_PRESET_MS}ms
              </Button>
              <Button onClick={() => setPosLatency.mutate(0)} disabled={setPosLatency.isPending}>
                Clear
              </Button>
            </div>
          </>
        )}
      </section>

      <section className="space-y-3 rounded-xl border-2 border-blue-200 bg-blue-50/40 p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Force duplicate delivery (headline case)</h2>
        {isChaosDisabled(availabilityChaos.error) ? (
          <ChaosDisabledNotice service="availability-service" />
        ) : (
          <>
            <p className="text-sm text-slate-500">
              Replays the last raw menu.events record this consumer processed through the same
              idempotency-checked path. Make a menu change first, then fire this.
            </p>
            <Button variant="primary" onClick={fireDuplicateDelivery} disabled={duplicateDelivery.isPending}>
              Fire duplicate delivery
            </Button>
            {duplicateDeliveryError && <InlineError>{duplicateDeliveryError}</InlineError>}

            {duplicateResult && (
              <div className="space-y-2 rounded-md bg-white p-3 text-sm">
                <p>
                  Event <span className="font-mono text-xs">{duplicateResult.response.eventId}</span> replayed —{" "}
                  <Badge tone={duplicateResult.response.accepted ? "success" : "danger"}>
                    {duplicateResult.response.accepted ? "accepted" : "rejected"}
                  </Badge>{" "}
                  ({duplicateResult.response.reason})
                </p>
                <p className="text-slate-600">
                  Item state before: <span className="font-mono">{duplicateResult.beforeItem?.status ?? "—"}</span>{" "}
                  → after: <span className="font-mono">{duplicateResult.afterItem?.status ?? "—"}</span>{" "}
                  {duplicateResult.beforeItem?.status === duplicateResult.afterItem?.status ? (
                    <Badge tone="success">unchanged</Badge>
                  ) : (
                    <Badge tone="danger">changed</Badge>
                  )}
                </p>
                {replaySpans.length > 0 && (
                  <p className="text-xs text-slate-500">
                    {replaySpans.length} live span(s) observed for this correlation ID since firing — the
                    second kafka.consume span really happened, it was just rejected by the dedupe check.
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
