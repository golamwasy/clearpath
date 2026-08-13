import { useEffect, useRef, useState } from "react";
import { useTraceStream } from "../../lib/traceStream";
import { useConsumerLag } from "../../api/queries/lag";
import { FLOW_NODES, FLOW_VIEWBOX, FlowEdgeMapper, nodeById, type EdgeStatus, type FlowEdgeEvent, type NodeId } from "../../lib/flowGraph";

interface Pulse extends FlowEdgeEvent {
  startedAt: number;
  durationMs: number;
}

const MIN_PULSE_MS = 400;
const MAX_PULSE_MS = 2000;
/** Error pulses stop partway rather than completing — this is how far along the edge they get. */
const ERROR_STOP_PROGRESS = 0.55;

function pulseDuration(latencyMs: number) {
  return Math.min(MAX_PULSE_MS, Math.max(MIN_PULSE_MS, latencyMs));
}

const STATIC_EDGES: Array<{ id: string; from: NodeId; to: NodeId }> = [
  { id: "web-menu", from: "merchant-web", to: "menu-service" },
  { id: "web-availability", from: "merchant-web", to: "availability-service" },
  { id: "web-pos", from: "merchant-web", to: "pos-ingest" },
  { id: "web-storefront", from: "merchant-web", to: "storefront-api" },
  { id: "menu-availability", from: "menu-service", to: "availability-service" },
  { id: "menu-collector", from: "menu-service", to: "trace-collector" },
  { id: "availability-collector", from: "availability-service", to: "trace-collector" },
  { id: "pos-collector", from: "pos-ingest", to: "trace-collector" },
  { id: "storefront-collector", from: "storefront-api", to: "trace-collector" },
];

function edgeColor(status: EdgeStatus | null) {
  if (status === "error") return "#dc2626";
  if (status === "ok") return "#2563eb";
  return "#cbd5e1";
}

export function FlowDiagram({ variant }: { variant: "sidebar" | "full" }) {
  const { spans, connected } = useTraceStream();
  const { data: lag } = useConsumerLag();
  // useRef(new FlowEdgeMapper()) would construct a new FlowEdgeMapper on every render (only the
  // first render's value is ever kept) — that's pure waste every render, and this component's own
  // requestAnimationFrame loop re-renders it up to ~60 times/second while any pulse is animating.
  const mapperRef = useRef<FlowEdgeMapper>();
  if (!mapperRef.current) mapperRef.current = new FlowEdgeMapper();
  // Tracks the last-processed span by ID, not by array length: traceStream's ring buffer stays at
  // a fixed 200 entries once full (old spans drop off the front as new ones arrive), so comparing
  // lengths alone stops detecting "new" spans the moment the buffer fills — the diagram would
  // otherwise silently freeze forever in any reasonably active session.
  const lastProcessedSpanId = useRef<string | null>(null);
  const [pulses, setPulses] = useState<Pulse[]>([]);
  const [, setTick] = useState(0);
  const rafRef = useRef<number>();

  useEffect(() => {
    if (spans.length === 0) return;
    const lastIndex = lastProcessedSpanId.current
      ? spans.findIndex((s) => s.spanId === lastProcessedSpanId.current)
      : -1;
    // lastIndex === -1 covers both "first run" and "the last span we saw already fell out of the
    // ring buffer" — in both cases, everything currently in the buffer is new to us.
    const newSpans = lastIndex === -1 ? spans : spans.slice(lastIndex + 1);
    lastProcessedSpanId.current = spans[spans.length - 1].spanId;
    if (newSpans.length === 0) return;
    const newPulses: Pulse[] = [];
    for (const span of newSpans) {
      for (const edge of mapperRef.current.edgesForSpan(span)) {
        newPulses.push({ ...edge, startedAt: performance.now(), durationMs: pulseDuration(edge.latencyMs) });
      }
    }
    if (newPulses.length > 0) setPulses((prev) => [...prev, ...newPulses]);
  }, [spans]);

  useEffect(() => {
    if (pulses.length === 0) return;
    const loop = () => {
      const now = performance.now();
      setPulses((prev) => prev.filter((p) => now - p.startedAt < p.durationMs));
      setTick((t) => t + 1);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [pulses.length]);

  const now = performance.now();
  const activeEdgeStatus = new Map<string, EdgeStatus>();
  for (const pulse of pulses) {
    const staticEdge = STATIC_EDGES.find(
      (e) => (e.from === pulse.from && e.to === pulse.to) || (e.from === pulse.to && e.to === pulse.from),
    );
    if (staticEdge) activeEdgeStatus.set(staticEdge.id, pulse.status);
  }

  // Under real (if bursty) traffic, several pulses land on the same edge close together — each
  // rendering its own label at that edge's fixed midpoint stacked them into unreadable overlapping
  // text. Only the newest pulse per edge gets a label; the rest still show their dot.
  const latestPulseKeyByEdge = new Map<string, { key: string; startedAt: number }>();
  for (const pulse of pulses) {
    const edgeKey = [pulse.from, pulse.to].sort().join("|");
    const current = latestPulseKeyByEdge.get(edgeKey);
    if (!current || pulse.startedAt > current.startedAt) {
      latestPulseKeyByEdge.set(edgeKey, { key: pulse.key, startedAt: pulse.startedAt });
    }
  }

  const lagByGroup = new Map((lag ?? []).map((entry) => [entry.groupId, entry]));

  return (
    <div className={variant === "full" ? "space-y-4" : "space-y-2"}>
      {variant === "full" && (
        <>
          <p className="text-sm text-slate-500">
            Live spans from trace-collector's SSE stream, mapped to the only hops that actually
            exist today. {!connected && <span className="text-amber-600">(stream disconnected — reconnecting)</span>}
          </p>
          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#2563eb]" /> moving dot = a span just
              arrived on that hop (label shows its latency)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#dc2626]" /> red = span reported an
              error (dot stops partway, doesn't complete the hop)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-4 bg-[#2563eb]" /> solid blue line = this hop saw traffic
              recently
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-4 bg-[#cbd5e1]" /> faint gray line = hop exists but idle
            </span>
          </div>
        </>
      )}
      <svg
        viewBox={`0 0 ${FLOW_VIEWBOX.width} ${FLOW_VIEWBOX.height}`}
        className="w-full rounded-xl border border-slate-200 bg-white"
        role="img"
        aria-label="System flow diagram"
      >
        {STATIC_EDGES.map((edge) => {
          const from = nodeById(edge.from);
          const to = nodeById(edge.to);
          const status = activeEdgeStatus.get(edge.id) ?? null;
          return (
            <line
              key={edge.id}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke={edgeColor(status)}
              strokeWidth={status ? 2.5 : 1.5}
              opacity={status ? 1 : 0.5}
            />
          );
        })}

        {pulses.map((pulse) => {
          const from = nodeById(pulse.from);
          const to = nodeById(pulse.to);
          let progress = Math.min(1, (now - pulse.startedAt) / pulse.durationMs);
          if (pulse.status === "error") progress = Math.min(progress, ERROR_STOP_PROGRESS);
          const x = from.x + (to.x - from.x) * progress;
          const y = from.y + (to.y - from.y) * progress;
          // Labeling the dot's own position runs the text straight through the source/destination
          // node circles whenever the dot is near either end (most of a short pulse's life) — and
          // for edges ending near the viewBox's own edge (storefront-api, menu-service,
          // availability-service all sit close to it), that text ran off the visible area
          // entirely. The edge's fixed midpoint is never that close to either node or the
          // viewBox boundary in this hexagon layout, so the label anchors there instead of
          // chasing the dot.
          const midX = (from.x + to.x) / 2;
          const midY = (from.y + to.y) / 2;
          const edgeKey = [pulse.from, pulse.to].sort().join("|");
          const showLabel = variant === "full" && latestPulseKeyByEdge.get(edgeKey)?.key === pulse.key;
          return (
            <g key={pulse.key}>
              <circle cx={x} cy={y} r={6} fill={edgeColor(pulse.status)} />
              {showLabel && (
                <text x={midX} y={midY - 10} textAnchor="middle" fontSize={11} fill={edgeColor(pulse.status)}>
                  {pulse.latencyMs}ms {pulse.latencyLabel}
                </text>
              )}
            </g>
          );
        })}

        {FLOW_NODES.map((node) => {
          const groupLag = lagByGroup.get(node.id);
          return (
            <g key={node.id}>
              <circle cx={node.x} cy={node.y} r={26} fill="#f8fafc" stroke="#94a3b8" strokeWidth={1.5} />
              <text x={node.x} y={node.y - 34} textAnchor="middle" fontSize={variant === "full" ? 12 : 10} fill="#334155" fontWeight={600}>
                {node.label}
              </text>
              {groupLag && variant === "full" && (
                <text
                  x={node.x}
                  y={node.y + 44}
                  textAnchor="middle"
                  fontSize={10}
                  fill={groupLag.lag > 0 ? "#b45309" : "#16a34a"}
                >
                  lag: {groupLag.lag}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
