import type { Span } from "./traceStream";

export type NodeId =
  | "merchant-web"
  | "menu-service"
  | "availability-service"
  | "pos-ingest"
  | "storefront-api"
  | "trace-collector"
  | "postgres-menu"
  | "kafka-menu-events"
  | "postgres-dedupe"
  | "redis"
  | "mongo"
  | "postgres-sync"
  | "kafka-pos-sync"
  | "external-client";

export type NodeKind = "service" | "store" | "topic" | "client";

export interface FlowNode {
  id: NodeId;
  label: string;
  /** Second line under the node — the concrete thing it holds, where that isn't obvious. */
  sublabel?: string;
  x: number;
  y: number;
  kind: NodeKind;
  /** Telemetry-plane nodes are drawn dimmed and below a divider — they observe, they don't serve. */
  plane: "data" | "telemetry";
}

export const FLOW_VIEWBOX = { width: 820, height: 560 };

/** Y coordinate of the rule separating the data path from the observability plane. */
export const TELEMETRY_DIVIDER_Y = 478;

/**
 * A left-to-right pipeline, not the old symmetric hexagon.
 *
 * The hexagon drew six services as undirected peers with no stores and no arrowheads, so it could
 * not show which way anything moved, what a line represented, or where the transactional outbox
 * lived — the one mechanism this system's first invariant is about. This layout puts the write path
 * along the top in the order it actually executes, hangs each service's stores off it, and demotes
 * trace-collector to a dimmed plane underneath, because telemetry is the instrument, not the machine.
 */
export const FLOW_NODES: FlowNode[] = [
  // merchant-web calls three services directly, so those three sit in one column beside it and its
  // edges stay short — that relationship is the one a merchant demo leans on most.
  { id: "merchant-web", label: "merchant-web", sublabel: "this browser", x: 78, y: 215, kind: "client", plane: "data" },
  { id: "menu-service", label: "menu-service", sublabel: "Kotlin", x: 252, y: 82, kind: "service", plane: "data" },
  { id: "availability-service", label: "availability-service", sublabel: "Kotlin", x: 252, y: 300, kind: "service", plane: "data" },
  { id: "pos-ingest", label: "pos-ingest", sublabel: "Go", x: 252, y: 440, kind: "service", plane: "data" },

  // Each service's own storage flows rightward from it.
  { id: "postgres-menu", label: "Postgres", sublabel: "items + outbox", x: 470, y: 82, kind: "store", plane: "data" },
  { id: "kafka-menu-events", label: "menu.events", sublabel: "Kafka topic", x: 690, y: 82, kind: "topic", plane: "data" },
  { id: "postgres-dedupe", label: "Postgres", sublabel: "processed_events", x: 470, y: 248, kind: "store", plane: "data" },
  { id: "redis", label: "Redis", sublabel: "current state", x: 470, y: 306, kind: "store", plane: "data" },
  { id: "mongo", label: "Mongo", sublabel: "audit log", x: 470, y: 364, kind: "store", plane: "data" },
  { id: "postgres-sync", label: "Postgres", sublabel: "sync_runs", x: 78, y: 440, kind: "store", plane: "data" },
  { id: "kafka-pos-sync", label: "pos.sync", sublabel: "Kafka topic", x: 470, y: 440, kind: "topic", plane: "data" },

  // Read side. Not reachable from this browser — no CORS — so its caller is drawn as what it is.
  { id: "storefront-api", label: "storefront-api", sublabel: "read composition", x: 690, y: 372, kind: "service", plane: "data" },
  { id: "external-client", label: "storefront client", sublabel: "k6 / curl", x: 690, y: 290, kind: "client", plane: "data" },

  { id: "trace-collector", label: "trace-collector", sublabel: "spans → Mongo", x: 400, y: 520, kind: "service", plane: "telemetry" },
];

export interface FlowEdge {
  id: string;
  from: NodeId;
  to: NodeId;
  /** The actual mechanism, in the system's own vocabulary — not a generic "calls". */
  label?: string;
  plane: "data" | "telemetry";
  /**
   * Perpendicular bow, in viewBox units, for edges that would otherwise cut straight through
   * unrelated boxes. Positive bows one way, negative the other; omitted means a straight line.
   * Curving the few cross-cutting hops is what lets the rest of the diagram stay orthogonal and
   * readable instead of becoming the tangle of diagonals a flat force layout produces.
   */
  curve?: number;
  /**
   * False means the hop is structurally real but emits no span, so it will never pulse. Drawing it
   * anyway (dimmed, and captioned as such) is more honest than omitting it: the alternative implies
   * availability-service doesn't write an audit log, when in fact that write just isn't instrumented
   * (MongoAuditStore.append is deliberately not one of the five instrumented boundary types).
   */
  instrumented: boolean;
}

export const FLOW_EDGES: FlowEdge[] = [
  { id: "web-menu", from: "merchant-web", to: "menu-service", label: "HTTP", plane: "data", instrumented: true },
  { id: "web-avail", from: "merchant-web", to: "availability-service", label: "HTTP", plane: "data", instrumented: true },
  { id: "web-pos", from: "merchant-web", to: "pos-ingest", label: "HTTP", plane: "data", instrumented: true },

  { id: "menu-pg", from: "menu-service", to: "postgres-menu", label: "tx: item + outbox row", plane: "data", instrumented: true },
  { id: "pg-kafka", from: "postgres-menu", to: "kafka-menu-events", label: "outbox relay", plane: "data", instrumented: true },
  // The one genuinely long hop: the topic is on the far right, its consumer on the far left. Bowed
  // so it sweeps under the store column instead of slicing through it.
  { id: "kafka-avail", from: "kafka-menu-events", to: "availability-service", label: "consume", plane: "data", instrumented: true, curve: 150 },

  { id: "avail-dedupe", from: "availability-service", to: "postgres-dedupe", label: "dedupe check", plane: "data", instrumented: true },
  { id: "avail-redis", from: "availability-service", to: "redis", label: "write state", plane: "data", instrumented: true },
  { id: "avail-mongo", from: "availability-service", to: "mongo", label: "audit append", plane: "data", instrumented: false },

  { id: "pos-pg", from: "pos-ingest", to: "postgres-sync", label: "sync run", plane: "data", instrumented: true },
  { id: "pos-kafka", from: "pos-ingest", to: "kafka-pos-sync", label: "publish", plane: "data", instrumented: true },

  { id: "client-storefront", from: "external-client", to: "storefront-api", label: "HTTP", plane: "data", instrumented: true },

  // Telemetry. Each bows around whatever it would otherwise pass straight through — sign and
  // magnitude are tuned per edge against the real layout, not applied uniformly.
  { id: "menu-collector", from: "menu-service", to: "trace-collector", plane: "telemetry", instrumented: true, curve: 150 },
  { id: "avail-collector", from: "availability-service", to: "trace-collector", plane: "telemetry", instrumented: true, curve: -90 },
  { id: "pos-collector", from: "pos-ingest", to: "trace-collector", plane: "telemetry", instrumented: true, curve: 40 },
  { id: "storefront-collector", from: "storefront-api", to: "trace-collector", plane: "telemetry", instrumented: true, curve: 60 },
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
  /** Human label for what the latency number means — the edge kinds measure different things. */
  latencyLabel: string;
}

const PUBLISH_PAIRING_TTL_MS = 30_000;
const MENU_EVENTS_TOPIC = "menu.events";

/**
 * Maps live spans from the SSE stream onto the drawn edges. Every mapping below is backed by a span
 * this system genuinely emits — verified against a real write, which produces exactly six:
 * `http.POST …/items`, `db.commit items`, `kafka.publish menu.events` (menu-service), then
 * `kafka.consume menu.events`, `db.commit processed_events`, `redis.write availability`
 * (availability-service).
 *
 * A span can be evidence of more than one edge (an http.* span is both the inbound hop AND that
 * service's trace-collector hop), so this returns an array. A span matching nothing returns [] —
 * the caller draws no edge rather than guessing at one.
 */
export class FlowEdgeMapper {
  private pendingPublishes = new Map<string, { finishedAtMs: number }>();

  edgesForSpan(span: Span): FlowEdgeEvent[] {
    this.evictStale();

    const status: EdgeStatus = span.status === "error" ? "error" : "ok";
    const sourceNode = SERVICE_TO_NODE[span.service];
    const edges: FlowEdgeEvent[] = [];
    const push = (from: NodeId, to: NodeId, suffix: string, latencyMs: number, latencyLabel: string) =>
      edges.push({ key: `${span.spanId}-${suffix}`, from, to, latencyMs, status, latencyLabel });

    if (span.operation.startsWith("http.") && sourceNode) {
      // storefront-api is not reachable from this browser (it sends no CORS headers), so an inbound
      // HTTP span on it came from k6 or curl, not from merchant-web. Drawing it as a merchant-web
      // hop would credit this page with a request it cannot make.
      const caller: NodeId = sourceNode === "storefront-api" ? "external-client" : "merchant-web";
      push(caller, sourceNode, "http", span.durationMs, "server duration");
    }

    if (sourceNode === "menu-service" && span.operation === "db.commit items") {
      // The item row and its outbox row commit in this one transaction — CLAUDE.md invariant 1.
      push("menu-service", "postgres-menu", "db", span.durationMs, "commit");
    }

    if (sourceNode === "menu-service" && span.operation === `kafka.publish ${MENU_EVENTS_TOPIC}`) {
      // Drawn from Postgres rather than from the service: the relay reads a committed outbox row and
      // publishes it, which is precisely why a write and a publish can never diverge here.
      push("postgres-menu", "kafka-menu-events", "publish", span.durationMs, "broker ack");
      this.pendingPublishes.set(this.pairKey(span.correlationId), { finishedAtMs: Date.parse(span.finishedAt) });
    }

    if (sourceNode === "availability-service" && span.operation === `kafka.consume ${MENU_EVENTS_TOPIC}`) {
      const key = this.pairKey(span.correlationId);
      const publish = this.pendingPublishes.get(key);
      this.pendingPublishes.delete(key);
      // Without the paired publish (the relay span fell out of the TTL window, or this consume is a
      // chaos-panel replay of an older record) the hop is still real — only the publish→consume gap
      // is unknowable, so fall back to the consume's own duration and say which one is shown.
      if (publish) {
        push(
          "kafka-menu-events",
          "availability-service",
          "kafka",
          Math.max(0, Date.parse(span.startedAt) - publish.finishedAtMs),
          "publish→consume gap",
        );
      } else {
        push("kafka-menu-events", "availability-service", "kafka", span.durationMs, "consume duration");
      }
    }

    if (sourceNode === "availability-service" && span.operation.startsWith("db.commit processed_events")) {
      push("availability-service", "postgres-dedupe", "dedupe", span.durationMs, "dedupe commit");
    }

    if (sourceNode === "availability-service" && span.operation.startsWith("redis.write")) {
      push("availability-service", "redis", "redis", span.durationMs, "write");
    }

    if (sourceNode === "pos-ingest" && span.operation.startsWith("db.commit sync_runs")) {
      push("pos-ingest", "postgres-sync", "possync", span.durationMs, "sync run");
    }

    if (sourceNode === "pos-ingest" && span.operation.startsWith("kafka.publish")) {
      push("pos-ingest", "kafka-pos-sync", "pospub", span.durationMs, "broker ack");
    }

    // Every span's own arrival here is evidence that service's system.trace transport hop
    // succeeded. There's no span-about-a-span (tracing is fire-and-forget, deliberately not itself
    // instrumented — ADR 0003), so the closest honest measurement of that hop's latency is how long
    // ago the span finished relative to now, at the moment it's observed here.
    if (sourceNode && sourceNode !== "trace-collector") {
      push(sourceNode, "trace-collector", "collector", Math.max(0, Date.now() - Date.parse(span.finishedAt)), "delivery lag");
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

/** Static edge whose endpoints match a live pulse, in either direction. */
export function edgeFor(from: NodeId, to: NodeId): FlowEdge | undefined {
  return FLOW_EDGES.find(
    (e) => (e.from === from && e.to === to) || (e.from === to && e.to === from),
  );
}
