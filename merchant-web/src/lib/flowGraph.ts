import type { Span } from "./traceStream";

export type NodeId =
  | "merchant-web"
  | "menu-service"
  | "availability-service"
  | "pos-ingest"
  | "storefront-api"
  | "trace-collector";

export interface FlowNode {
  id: NodeId;
  label: string;
  x: number;
  y: number;
}

export const FLOW_VIEWBOX = { width: 640, height: 440 };

/** Hexagon layout. Fixed, not computed, so pulse geometry is deterministic and testable. */
export const FLOW_NODES: FlowNode[] = [
  { id: "merchant-web", label: "merchant-web", x: 320, y: 55 },
  { id: "menu-service", label: "menu-service", x: 560, y: 140 },
  { id: "availability-service", label: "availability-service", x: 560, y: 320 },
  { id: "trace-collector", label: "trace-collector", x: 320, y: 410 },
  { id: "pos-ingest", label: "pos-ingest", x: 80, y: 320 },
  { id: "storefront-api", label: "storefront-api", x: 80, y: 140 },
];

const SERVICE_TO_NODE: Partial<Record<string, NodeId>> = {
  "menu-service": "menu-service",
  "availability-service": "availability-service",
  "pos-ingest": "pos-ingest",
  "storefront-api": "storefront-api",
  "trace-collector": "trace-collector",
};

export type EdgeStatus = "ok" | "error";

export interface FlowEdgeEvent {
  key: string;
  from: NodeId;
  to: NodeId;
  latencyMs: number;
  status: EdgeStatus;
  /** Human label for what the latency number means — the two edge kinds measure different things. */
  latencyLabel: string;
}

const PUBLISH_PAIRING_TTL_MS = 30_000;
const MENU_EVENTS_TOPIC = "menu.events";

/**
 * Maps live spans from the SSE stream to the drawn edges in "What's real vs. deliberately
 * absent" (docs/plan-phase5.md): merchant-web -> {menu-service, availability-service,
 * pos-ingest} from http.* spans, menu-service -> availability-service by pairing
 * kafka.publish/kafka.consume menu.events spans on correlationId, and
 * {menu-service, availability-service, pos-ingest} -> trace-collector from every span's own
 * arrival. A span can be evidence of more than one edge (an http.* span is both the
 * merchant-web hop AND that service's trace-collector hop), so this returns an array, not a
 * single edge. Spans that map to none of these (db.commit, redis.write, ...) return [] — the
 * caller can still flash the owning node, just draws no edge.
 */
export class FlowEdgeMapper {
  private pendingPublishes = new Map<string, { finishedAtMs: number }>();

  edgesForSpan(span: Span): FlowEdgeEvent[] {
    this.evictStale();

    const status: EdgeStatus = span.status === "error" ? "error" : "ok";
    const sourceNode = SERVICE_TO_NODE[span.service];
    const edges: FlowEdgeEvent[] = [];

    if (span.operation.startsWith("http.") && sourceNode) {
      edges.push({
        key: `${span.spanId}-http`,
        from: "merchant-web",
        to: sourceNode,
        latencyMs: span.durationMs,
        status,
        latencyLabel: "server duration",
      });
    }

    if (sourceNode === "menu-service" && span.operation === `kafka.publish ${MENU_EVENTS_TOPIC}`) {
      this.pendingPublishes.set(this.pairKey(span.correlationId), { finishedAtMs: Date.parse(span.finishedAt) });
    }

    if (sourceNode === "availability-service" && span.operation === `kafka.consume ${MENU_EVENTS_TOPIC}`) {
      const key = this.pairKey(span.correlationId);
      const publish = this.pendingPublishes.get(key);
      this.pendingPublishes.delete(key);
      if (publish) {
        edges.push({
          key: `${span.spanId}-kafka`,
          from: "menu-service",
          to: "availability-service",
          latencyMs: Math.max(0, Date.parse(span.startedAt) - publish.finishedAtMs),
          status,
          latencyLabel: "publish→consume gap",
        });
      }
    }

    // Every span's own arrival here is evidence that service's system.trace transport hop
    // succeeded. There's no span-about-a-span (tracing is fire-and-forget, deliberately not
    // itself instrumented — ADR 0003), so the closest honest measurement of that hop's latency
    // is how long ago the span finished relative to now, at the moment it's observed here.
    if (sourceNode) {
      edges.push({
        key: `${span.spanId}-collector`,
        from: sourceNode,
        to: "trace-collector",
        latencyMs: Math.max(0, Date.now() - Date.parse(span.finishedAt)),
        status,
        latencyLabel: "delivery lag",
      });
    }

    return edges;
  }

  private pairKey(correlationId: string) {
    return `${correlationId}:${MENU_EVENTS_TOPIC}`;
  }

  private evictStale() {
    const cutoff = Date.now() - PUBLISH_PAIRING_TTL_MS;
    for (const [key, value] of this.pendingPublishes) {
      if (value.finishedAtMs < cutoff) this.pendingPublishes.delete(key);
    }
  }
}

export function nodeById(id: NodeId): FlowNode {
  const node = FLOW_NODES.find((n) => n.id === id);
  if (!node) throw new Error(`unknown flow node ${id}`);
  return node;
}
