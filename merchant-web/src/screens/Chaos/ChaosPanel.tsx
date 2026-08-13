import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "../../components/ui/PageHeader";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { InlineError } from "../../components/ui/InlineError";
import { ApiError } from "../../api/client";
import { useTraceStream } from "../../lib/traceStream";
import { useCurrentVenue } from "../../lib/venueSelection";
import { recordDuplicateDelivery } from "../../lib/tourObservations";
import { SourceTag } from "../../components/ui/SourceTag";
import { InvariantBadge } from "../../components/ui/InvariantBadge";
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

const LATENCY_PRESET_MS = 3000;

function ChaosDisabledNotice({ service }: { service: string }) {
  return <InlineError>Chaos endpoints disabled on {service} (CHAOS_ENABLED=false).</InlineError>;
}

function isRecordWithReason(body: unknown): body is { reason: string } {
  return typeof body === "object" && body !== null && typeof (body as { reason?: unknown }).reason === "string";
}

export function ChaosPanel() {
  // Venue now comes from menu-service's venue list rather than a build-time env var, so the
  // duplicate-delivery before/after diff has a real venue to read item state from even on a stack
  // that was set up in this browser session.
  const { venueId } = useCurrentVenue();
  const currentVenueId = venueId ?? "";
  const availabilityChaos = useAvailabilityChaosState();
  const posChaos = usePosChaosState();
  const pauseConsumer = usePauseConsumer();
  const resumeConsumer = useResumeConsumer();
  const breakRedis = useBreakRedis();
  const restoreRedis = useRestoreRedis();
  const setPosLatency = useSetPosLatency();
  const duplicateDelivery = useDuplicateDelivery(currentVenueId);
  const queryClient = useQueryClient();
  const { spans } = useTraceStream();
  // Mounted so there's an active observer to snapshot before/after against — not rendered
  // directly, this screen only shows the diff for the one item the replay touched.
  const availability = useVenueAvailability(currentVenueId);

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
      await queryClient.refetchQueries({ queryKey: availabilityQueryKey(currentVenueId) });
      const afterItems =
        queryClient.getQueryData<AvailabilityResponse>(availabilityQueryKey(currentVenueId))?.items ?? [];
      const beforeItem = beforeItems.find((i) => i.itemId === response.itemId);
      const afterItem = afterItems.find((i) => i.itemId === response.itemId);
      setDuplicateResult({ response, beforeItem, afterItem });
      // availability-service's real verdict, forwarded to the tour. Both halves matter: a rejected
      // replay that still mutated state would be a failed guarantee, not a passed one.
      recordDuplicateDelivery({
        accepted: response.accepted,
        stateUnchanged: beforeItem?.status === afterItem?.status,
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
        subtitle={
          <>
            Every control here mutates real state inside the running service that owns it — the
            consumer really stops polling, Redis really starts refusing, latency is really injected
            into the poll loop. There is no simulation in this browser, which is why the failures look
            like failures everywhere else in the app while they are switched on.
          </>
        }
        source={<SourceTag origin="availability-service + pos-ingest" freshness="CHAOS_ENABLED" />}
      />

      <section className="space-y-3 rounded-xl border-2 border-blue-300 bg-blue-50/60 p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
            Start here
          </span>
          <h2 className="text-base font-semibold text-slate-900">Force a duplicate delivery</h2>
          <InvariantBadge n={2} />
        </div>
        <p className="max-w-prose text-sm text-slate-600">
          Kafka guarantees at-least-once delivery, so every consumer will eventually see the same
          message twice. This replays the last raw menu.events record byte-for-byte through the exact
          path the poll loop uses — the dedupe table rejects it, and item state does not move.
        </p>
        {isChaosDisabled(availabilityChaos.error) ? (
          <ChaosDisabledNotice service="availability-service" />
        ) : (
          <>
            <p className="text-sm text-slate-500">
              Only the <em>last</em> record the consumer processed can be replayed (it caches one raw
              record, not a history), so this reads most clearly right after a real menu change.
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

      <h2 className="pt-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
        Other faults you can inject
      </h2>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-900">Pause menu.events consumer</h3>
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
        <h3 className="text-sm font-semibold text-slate-900">Break Redis</h3>
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
        <h3 className="text-sm font-semibold text-slate-900">Inject pos-ingest latency</h3>
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
    </div>
  );
}
