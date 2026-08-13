import { useEffect, useRef, useState } from "react";
import { useTraceStream } from "../../lib/traceStream";
import { useConsumerLag } from "../../api/queries/lag";
import {
  FLOW_EDGES,
  FLOW_NODES,
  FLOW_VIEWBOX,
  FlowEdgeMapper,
  TELEMETRY_DIVIDER_Y,
  edgeFor,
  nodeById,
  type EdgeStatus,
  type FlowEdge,
  type FlowEdgeEvent,
  type FlowNode,
} from "../../lib/flowGraph";

interface Pulse extends FlowEdgeEvent {
  startedAt: number;
  durationMs: number;
}

const MIN_PULSE_MS = 500;
const MAX_PULSE_MS = 2200;
/** Error pulses stop partway rather than completing — this is how far along the edge they get. */
const ERROR_STOP_PROGRESS = 0.55;

const COLOR = {
  ok: "#2563eb",
  error: "#dc2626",
  idle: "#cbd5e1",
  telemetry: "#cbd5e1",
  uninstrumented: "#e2e8f0",
};

/** Half-extents of a node box, in viewBox units. Edges stop at the box, not at its centre. */
const NODE_HALF_W = 58;
const NODE_HALF_H = 18;

function pulseDuration(latencyMs: number) {
  return Math.min(MAX_PULSE_MS, Math.max(MIN_PULSE_MS, latencyMs));
}

interface EdgeGeometry {
  path: string;
  /** Point along the edge at 0..1, used for the pulse dot and for label placement. */
  pointAt: (t: number) => { x: number; y: number };
}

/** Distance from a node's centre to its box border along a given direction. */
function insetFor(dx: number, dy: number) {
  const length = Math.hypot(dx, dy) || 1;
  const tX = Math.abs(dx) > 0.001 ? NODE_HALF_W / Math.abs(dx / length) : Infinity;
  const tY = Math.abs(dy) > 0.001 ? NODE_HALF_H / Math.abs(dy / length) : Infinity;
  return Math.min(tX, tY);
}

/**
 * Builds an edge as a straight line, or as a quadratic bezier bowed perpendicular to it when the
 * edge declares a `curve`. Endpoints are pulled back to each node's box border so arrowheads land
 * on the border rather than disappearing underneath the box they point at.
 */
function edgeGeometry(from: FlowNode, to: FlowNode, curve: number | undefined): EdgeGeometry {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;

  if (!curve) {
    const ux = dx / length;
    const uy = dy / length;
    const start = { x: from.x + ux * insetFor(dx, dy), y: from.y + uy * insetFor(dx, dy) };
    const endInset = insetFor(dx, dy) + 5;
    const end = { x: to.x - ux * endInset, y: to.y - uy * endInset };
    return {
      path: `M ${start.x} ${start.y} L ${end.x} ${end.y}`,
      pointAt: (t) => ({ x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t }),
    };
  }

  // Control point: the midpoint, pushed along the edge's perpendicular.
  const control = {
    x: (from.x + to.x) / 2 + (-dy / length) * curve,
    y: (from.y + to.y) / 2 + (dx / length) * curve,
  };
  // Trim along each end's own tangent, which for a quadratic is the direction to/from the control
  // point — not the straight-line direction, which would leave a visible gap on a strong bow.
  const startDir = { x: control.x - from.x, y: control.y - from.y };
  const endDir = { x: to.x - control.x, y: to.y - control.y };
  const startLen = Math.hypot(startDir.x, startDir.y) || 1;
  const endLen = Math.hypot(endDir.x, endDir.y) || 1;
  const startInset = insetFor(startDir.x, startDir.y);
  const endInset = insetFor(endDir.x, endDir.y) + 5;

  const start = {
    x: from.x + (startDir.x / startLen) * startInset,
    y: from.y + (startDir.y / startLen) * startInset,
  };
  const end = {
    x: to.x - (endDir.x / endLen) * endInset,
    y: to.y - (endDir.y / endLen) * endInset,
  };

  return {
    path: `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`,
    pointAt: (t) => {
      const inv = 1 - t;
      return {
        x: inv * inv * start.x + 2 * inv * t * control.x + t * t * end.x,
        y: inv * inv * start.y + 2 * inv * t * control.y + t * t * end.y,
      };
    },
  };
}

function edgeColor(edge: FlowEdge, status: EdgeStatus | null) {
  if (status === "error") return COLOR.error;
  if (status === "ok") return COLOR.ok;
  if (!edge.instrumented) return COLOR.uninstrumented;
  return edge.plane === "telemetry" ? COLOR.telemetry : COLOR.idle;
}

export function FlowDiagram({ variant }: { variant: "sidebar" | "full" }) {
  const { spans, connected } = useTraceStream();
  const { data: lag } = useConsumerLag();
  // useRef(new FlowEdgeMapper()) would construct a new FlowEdgeMapper on every render (only the
  // first render's value is ever kept) — that's pure waste every render, and this component's own
  // requestAnimationFrame loop re-renders it up to ~60 times/second while any pulse is animating.
  const mapperRef = useRef<FlowEdgeMapper | null>(null);
  if (!mapperRef.current) mapperRef.current = new FlowEdgeMapper();
  const mapper = mapperRef.current;
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
      for (const edge of mapper.edgesForSpan(span)) {
        newPulses.push({ ...edge, startedAt: performance.now(), durationMs: pulseDuration(edge.latencyMs) });
      }
    }
    if (newPulses.length > 0) setPulses((prev) => [...prev, ...newPulses]);
  }, [spans, mapper]);

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
    const staticEdge = edgeFor(pulse.from, pulse.to);
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
  const isFull = variant === "full";

  // One geometry per drawn edge, reused by both the static line and any pulse riding it — so a dot
  // always travels the exact curve that is drawn, never a straight line across a bowed edge.
  const geometryByEdgeId = new Map(
    FLOW_EDGES.map((edge) => [edge.id, edgeGeometry(nodeById(edge.from), nodeById(edge.to), edge.curve)] as const),
  );

  return (
    <div className={isFull ? "space-y-3" : "space-y-2"}>
      {isFull && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-600">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#2563eb]" />
            moving dot = a real span just arrived on that hop
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#dc2626]" />
            red = span reported an error (stops partway)
          </span>
          <span className="flex items-center gap-1.5">
            <svg width="26" height="8" aria-hidden="true">
              <line x1="0" y1="4" x2="26" y2="4" stroke={COLOR.idle} strokeWidth="1.5" />
            </svg>
            hop exists, currently idle
          </span>
          <span className="flex items-center gap-1.5">
            <svg width="26" height="8" aria-hidden="true">
              <line x1="0" y1="4" x2="26" y2="4" stroke={COLOR.uninstrumented} strokeWidth="1.5" strokeDasharray="3 3" />
            </svg>
            real hop, but emits no span — never pulses
          </span>
        </div>
      )}

      <svg
        viewBox={`0 0 ${FLOW_VIEWBOX.width} ${FLOW_VIEWBOX.height}`}
        className="w-full rounded-xl border border-slate-200 bg-white"
        role="img"
        aria-label="System flow: merchant-web writes to menu-service, which commits the item and an outbox row to Postgres; the outbox relay publishes to the menu.events Kafka topic; availability-service consumes it, checks its dedupe table, and writes Redis. Every service also emits spans to trace-collector."
      >
        <defs>
          {Object.entries({ ok: COLOR.ok, error: COLOR.error, idle: COLOR.idle, uninstrumented: COLOR.uninstrumented }).map(
            ([name, color]) => (
              <marker
                key={name}
                id={`arrow-${name}-${variant}`}
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="5"
                markerHeight="5"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
              </marker>
            ),
          )}
        </defs>

        {/* Observability plane divider — telemetry is the instrument, not the machine. */}
        <line
          x1={12}
          y1={TELEMETRY_DIVIDER_Y}
          x2={FLOW_VIEWBOX.width - 12}
          y2={TELEMETRY_DIVIDER_Y}
          stroke="#e2e8f0"
          strokeWidth={1}
          strokeDasharray="4 4"
        />
        <text x={14} y={TELEMETRY_DIVIDER_Y - 7} fontSize={10} fill="#94a3b8">
          observability plane — how you are able to see any of the above
        </text>

        {FLOW_EDGES.map((edge) => {
          const status = activeEdgeStatus.get(edge.id) ?? null;
          const geometry = geometryByEdgeId.get(edge.id)!;
          const color = edgeColor(edge, status);
          const markerName = status ?? (edge.instrumented ? "idle" : "uninstrumented");
          // Labels sit slightly past the midpoint and above the path. On a bowed edge the midpoint
          // of the curve is nowhere near the midpoint of the straight line, which is why this reads
          // the point off the geometry rather than averaging the endpoints.
          const labelAt = geometry.pointAt(0.5);
          return (
            <g key={edge.id}>
              <path
                d={geometry.path}
                fill="none"
                stroke={color}
                strokeWidth={status ? 2.4 : 1.3}
                strokeDasharray={edge.instrumented ? undefined : "3 3"}
                opacity={status ? 1 : edge.plane === "telemetry" ? 0.5 : 0.85}
                markerEnd={`url(#arrow-${markerName}-${variant})`}
              />
              {isFull && edge.label && !status && (
                <text
                  x={labelAt.x}
                  y={labelAt.y - 6}
                  textAnchor="middle"
                  fontSize={9}
                  fill="#94a3b8"
                  paintOrder="stroke"
                  stroke="#ffffff"
                  strokeWidth={3}
                  strokeLinejoin="round"
                >
                  {edge.label}
                </text>
              )}
            </g>
          );
        })}

        {pulses.map((pulse) => {
          const staticEdge = edgeFor(pulse.from, pulse.to);
          const geometry = staticEdge ? geometryByEdgeId.get(staticEdge.id) : undefined;
          if (!geometry || !staticEdge) return null;
          let progress = Math.min(1, (now - pulse.startedAt) / pulse.durationMs);
          if (pulse.status === "error") progress = Math.min(progress, ERROR_STOP_PROGRESS);
          // A pulse can be emitted in the opposite direction to how the edge is drawn (the mapper
          // reports the hop, `edgeFor` matches either orientation), so travel the path backwards
          // rather than having the dot slide the wrong way down the arrow.
          const forwards = staticEdge.from === pulse.from;
          const position = geometry.pointAt(forwards ? progress : 1 - progress);
          const labelAt = geometry.pointAt(0.5);
          const edgeKey = [pulse.from, pulse.to].sort().join("|");
          const showLabel = isFull && latestPulseKeyByEdge.get(edgeKey)?.key === pulse.key;
          const color = pulse.status === "error" ? COLOR.error : COLOR.ok;
          return (
            <g key={pulse.key}>
              <circle cx={position.x} cy={position.y} r={5.5} fill={color} />
              {showLabel && (
                <text
                  x={labelAt.x}
                  y={labelAt.y - 6}
                  textAnchor="middle"
                  fontSize={10}
                  fontWeight={600}
                  fill={color}
                  paintOrder="stroke"
                  stroke="#ffffff"
                  strokeWidth={3.5}
                  strokeLinejoin="round"
                >
                  {pulse.latencyMs}ms {pulse.latencyLabel}
                </text>
              )}
            </g>
          );
        })}

        {FLOW_NODES.map((node) => {
          const groupLag = lagByGroup.get(node.id);
          const isStore = node.kind === "store" || node.kind === "topic";
          const dimmed = node.plane === "telemetry";
          return (
            <g key={node.id} opacity={dimmed ? 0.7 : 1}>
              <rect
                x={node.x - NODE_HALF_W}
                y={node.y - NODE_HALF_H}
                width={NODE_HALF_W * 2}
                height={NODE_HALF_H * 2}
                rx={node.kind === "topic" ? 14 : 5}
                fill={isStore ? "#ffffff" : "#f1f5f9"}
                stroke={isStore ? "#94a3b8" : "#64748b"}
                strokeWidth={1.3}
                strokeDasharray={node.kind === "client" ? "4 3" : undefined}
              />
              <text
                x={node.x}
                y={node.sublabel ? node.y - 2 : node.y + 3}
                textAnchor="middle"
                fontSize={isFull ? 10.5 : 9}
                fontWeight={600}
                fill="#1e293b"
              >
                {node.label}
              </text>
              {node.sublabel && (
                <text x={node.x} y={node.y + 9} textAnchor="middle" fontSize={isFull ? 8.5 : 7.5} fill="#64748b">
                  {node.sublabel}
                </text>
              )}
              {groupLag && isFull && (
                <text
                  x={node.x}
                  y={node.y + NODE_HALF_H + 12}
                  textAnchor="middle"
                  fontSize={9.5}
                  fontWeight={600}
                  fill={groupLag.lag > 0 ? "#b45309" : "#16a34a"}
                >
                  consumer lag: {groupLag.lag}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {isFull && !connected && (
        <p className="text-xs text-amber-700">
          SSE stream disconnected — reconnecting. Nothing will pulse until it reattaches.
        </p>
      )}
    </div>
  );
}
