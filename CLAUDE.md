# Merchant Platform

A distributed merchant menu and availability system, with a frontend that
renders the system's own telemetry so distributed behaviour is observable
rather than assumed.

## Services

| Service | Language | Stores | Responsibility |
|---|---|---|---|
| menu-service | Kotlin / Ktor | Postgres | Canonical menu, transactional outbox |
| pos-ingest | Go | Postgres | Concurrent POS polling, normalization |
| availability-service | Kotlin / Ktor | Redis, Mongo | Hot read path, stock state, audit |
| storefront-api | Kotlin / Ktor | Redis | Read composition, cache |
| trace-collector | Kotlin / Ktor | Mongo | Trace ingestion, SSE fanout |
| merchant-web | React / TS / Vite | - | Merchant UI and system x-ray |

## Kafka topics

- `menu.events`: menu item created, updated, deleted
- `stock.events`: availability changes
- `pos.sync`: raw normalized POS payloads
- `system.trace`: span events from all services
- `<topic>.dlq` per consumer group

## Non-negotiable invariants

1. A Postgres write and a Kafka publish never diverge. Use the transactional
   outbox pattern. Never dual-write.
2. Every consumer is idempotent, keyed on a dedupe key persisted in its own
   store. Reprocessing the same message must be a no-op.
3. Every request carries a correlation ID, propagated across HTTP, gRPC, and
   Kafka headers.
4. Menu data is eventually consistent. Availability data is near real time.
   Do not blur this distinction.
5. Schema changes to Kafka topics must be backward compatible.

## Conventions

- Kotlin: Ktor, Koin for DI, Exposed or JDBI for SQL, kotlinx.serialization.
  No Spring in this repo.
- Go: standard library plus pgx, segmentio/kafka-go. No heavy framework.
- Frontend: React 18, TypeScript strict, Vite, TanStack Query, Tailwind.
  No Redux. No component library.
- API types on the frontend are generated from OpenAPI specs. Never hand
  written.
- Every service exposes /health, /ready, /metrics.
- Structured JSON logs. Every log line includes the correlation ID.
- Tests: unit tests colocated, integration tests with Testcontainers,
  contract tests between services.

## Architecture decisions

See `docs/adr/`. Read the relevant ADR before changing anything structural.
If you make a new structural decision, write a new ADR.

## Current state

Phase: 6 (deployability and observability)

Working:
- storefront-api (Kotlin/Ktor, new service, port 8085): one endpoint, `GET
  /venues/{venueId}/menu`, composing menu-service's `GET
  /venues/{venueId}/items` and availability-service's `GET
  /venues/{venueId}/availability` (sequential calls, joined on `itemId`),
  cached in Redis (`storefront:menu:{venueId}`,
  `STOREFRONT_MENU_CACHE_TTL_SECONDS`, default 5s, cache-aside). Items with
  no availability-service state yet are returned as `status: "unknown"`,
  never defaulted or dropped. Correlation ID propagated to both upstream
  calls; the composition is one `Tracer.withSpan`. Upstream/cache failures
  surface as `502` via a `StatusPages` handler. No Postgres, no writes, no
  new Kafka topic — matches its CLAUDE.md role ("Read composition, cache")
  exactly; built this phase specifically so the deployability work below
  had a genuine fifth JVM service to containerize and load-test, not a
  placeholder (`docs/adr/0007-storefront-api-stub.md`).
- Backward-compatible Kafka schema change demonstrated on `menu.events`:
  menu-service's `MenuEvent` gained `itemName: String? = null` (populated at
  all three event sites); availability-service's separate `MenuEvent` copy
  was deliberately left unmodified to play the role of "the old consumer"
  — safe because every consumer in this repo already sets
  `ignoreUnknownKeys = true`. `WritePathIntegrationTest`'s existing
  end-to-end assertion doubles as the automated proof (`itemName` isn't
  consumed anywhere yet — it exists to prove the mechanism, per
  `docs/adr/0006-schema-evolution-menu-events.md`, which also writes down
  the general safe rollout order for additive fields).
- Dockerfiles for all six custom images (menu-service, availability-service,
  pos-ingest, storefront-api, trace-collector, merchant-web) hardened to
  build on minimal base images and run as a created, unprivileged user
  instead of root.
- Kubernetes manifests (`deploy/k8s/`, kustomize, one `base/<service>/`
  directory per service including Postgres/Redis/Mongo/Kafka/Prometheus/
  Grafana): every application Deployment wired to `/health`/`/ready` via
  `livenessProbe`/`readinessProbe`, with `resources.requests`/`limits` set.
  `deploy/k8s/kind-up.sh`/`kind-down.sh` bring up a local `kind` cluster in
  one command (builds all eight images, loads them directly into the
  cluster, `imagePullPolicy: Never`, no registry pull). Infra runs
  single-replica on `emptyDir` volumes — a disposable local demo, not a
  durability story, called out explicitly in each manifest's comments and
  in the README's "Trade-offs" section. No `Ingress`, `NetworkPolicy`,
  `PodDisruptionBudget`, or `HorizontalPodAutoscaler`, and no pod-level
  `securityContext` enforcing non-root at the k8s layer (the Dockerfiles
  enforce it at the image layer, but nothing in the manifests would stop a
  base-image change from silently regressing that) — not addressed this
  phase. `deploy/k8s/base/secret-common.yaml` is a plaintext `Secret`
  manifest, committed, explicitly commented as a local-only shortcut.
- Real Prometheus metrics on `/metrics` for all five backend services
  (previously a stub returning a placeholder on all of them) —
  Micrometer-backed on the four Kotlin services, a hand-rolled exposition
  writer on pos-ingest — plus `trace-collector`'s `/consumer-lag` gauge
  also exposed as `kafka_consumer_lag` on its own `/metrics`. `deploy/
  prometheus/` + `deploy/grafana/provisioning/` scrape every service and
  provision one dashboard (`clearpath-dashboard.json`); both docker-compose
  and the kind manifests bring up Prometheus + Grafana.
- CI consolidated into a single `.github/workflows/ci.yml` (replacing the
  phase 4/5 `merchant-web`-only workflow): lint, unit tests, the
  Testcontainers integration suite, `merchant-web`'s build (OpenAPI
  type-gen gate), Playwright e2e against live docker-compose, a container
  build + Trivy vulnerability scan (severity `CRITICAL`, gating) for all
  eight images, and a GHCR push on `main`. No Kotlin lint/format gate
  (ktlint/detekt) added — the four JVM services' only static check remains
  compilation, deliberately deferred (see README "Trade-offs").
- k6 load test (`load-test/storefront-api.js`): 50 constant VUs, 2 minutes,
  against storefront-api's one endpoint, single `venueId`, real numbers
  from a real docker-compose run recorded in the README — explicitly
  caveated as flattered by the cache (5s TTL against one venue means most
  requests are Redis hits, not the real menu-service+availability-service
  fan-out a cache-miss costs).
- `merchant-web`'s `/system/flow` screen got legibility fixes (edges/pulses
  hard to distinguish at rest) found while smoke-testing the kind
  deployment end-to-end with a real browser.
- README rewritten: problem statement, architecture, both setup paths
  (docker-compose and kind), CI, the load test with its caveats, and a
  "Trade-offs and what I'd do differently at scale" section enumerating
  every known gap this phase didn't close.
- ADRs: `docs/adr/0006-schema-evolution-menu-events.md`,
  `docs/adr/0007-storefront-api-stub.md`. Full working plan in
  `docs/plan-phase6.md`.
- Note: this "Current state" section was not updated in the commit that
  landed phase 6 — backfilled after the fact once the gap was flagged by an
  external review. `docs/plan-phase6.md` was similarly missing and was
  backfilled at the same time. Neither omission changed anything about the
  phase 6 code itself.
- menu-service: Postgres schema (venues, categories, items, modifiers,
  prices, outbox), optimistic locking on items via `version`, REST endpoints
  (create/update/delete/list items, create venue), transactional outbox
  written in the same transaction as each domain write, in-process outbox
  relay publishing to `menu.events` after broker ack.
- availability-service: consumes `menu.events`, dedupes via a Postgres
  `processed_events` table keyed on event ID before processing, writes
  current availability state to Redis, appends every change to a Mongo
  `availability_audit` collection, REST endpoint to read availability for a
  venue (Redis-backed, never touches Mongo on the read path).
- pos-ingest (Go): provider adapters normalizing two deliberately mismatched
  mock POS wire formats (`mocks/nested-pos`: nested JSON, cents, string IDs;
  `mocks/flat-pos`: flat array, decimal-string prices, integer IDs) into a
  shared internal schema, with table-driven tests including malformed-input
  cases. Concurrent worker pool polls all configured venues (from
  `pos-ingest/venues.json`), bounded by `POS_MAX_CONCURRENCY`, with a
  per-provider `golang.org/x/time/rate` limiter. Fetch failures retry with
  exponential backoff + full jitter (`internal/retry`), distinguishing
  retryable (network/5xx) from non-retryable (malformed payload/4xx)
  errors; retry exhaustion publishes to `pos.sync.dlq`. Successful syncs
  publish one batch envelope per venue poll to `pos.sync`, keyed by venue
  ID, with a `correlationId` Kafka header (self-originated per poll cycle,
  since there's no inbound HTTP request to inherit one from). Every poll is
  recorded as a `sync_runs` row in its own Postgres database
  (idempotent-on-startup schema via `IF NOT EXISTS`, no migration framework
  dependency), readable via `GET /sync-runs`. Deliberately does **not** use
  the transactional-outbox pattern — `sync_runs` is this service's own
  operational log, not the source of truth the way `menu.events` is for
  menu-service, so Postgres/Kafka atomicity isn't the same invariant here
  (reasoning captured in `docs/plan-phase2.md`). No consumer was added to
  availability-service for `pos.sync` — out of scope per phase 2 instructions.
- `docker-compose.yml` + Dockerfiles for all three services plus the two POS
  mocks, plus Postgres, Redis, Mongo, Kafka. Verified end-to-end locally:
  both mock shapes normalize correctly, sync runs land in Postgres, and
  normalized batches land on `pos.sync` (confirmed via console consumer).
- Testcontainers integration test (`integration-test` module) exercising the
  full menu-service/availability-service path: POST item via menu-service
  REST API -> outbox -> relay -> Kafka -> availability-service consumer ->
  Redis, asserted within a timeout. Passing. (pos-ingest has no
  Testcontainers integration test yet — only table-driven unit tests plus
  the manual docker-compose verification above.)
- `tracing-core` (Kotlin library, `menu-service`/`availability-service`/
  `trace-collector` depend on it): `Tracer.withSpan` records start/end time,
  service name, operation, and the ambient correlation ID, then publishes a
  `Span` to `system.trace` fire-and-forget (async Kafka send, publish
  failures logged not thrown). `TraceContext` is passed explicitly through
  call sites rather than carried on a ThreadLocal/MDC, since spans must nest
  correctly across Ktor's Netty dispatcher and Exposed's blocking JDBC calls
  on `Dispatchers.IO`. `installTracing` wraps every HTTP request in a root
  span (extracting `X-Correlation-Id` or generating one) via
  `ApplicationCallPipeline.Monitoring` interception, replacing the old
  standalone `CorrelationIdPlugin`.
- `pos-ingest/internal/tracing` (Go): same wire format, propagated via
  `context.Context` instead of an explicit parameter, since `context.Context`
  is already the idiomatic ambient mechanism used throughout `pos-ingest`.
- Instrumented boundaries, existing code only (HTTP entry, DB commit, Kafka
  publish, Kafka consume, Redis write — wherever each actually exists):
  menu-service (`itemRoutes` HTTP entry, `ItemRepository`'s transactions,
  `OutboxRelay`'s Kafka publish per outbox row), availability-service
  (`availabilityRoutes` HTTP entry, `MenuEventConsumer`'s Kafka consume,
  `IdempotencyStore`'s transaction, `RedisAvailabilityStore.put`), pos-ingest
  (`api/handlers.go` routes, `store.StartRun`/`FinishRun`,
  `kafka.Producer.PublishSync`/`PublishDLQ`). `MongoAuditStore.append` is
  deliberately not instrumented — not one of the five boundary types.
  Outbox-relay and menu-event-consumer spans are emitted with `root=true`
  even though they aren't the trace's true origin, because `menu.events`/the
  outbox table carry a correlation ID but no span ID to propagate as a real
  parent (documented in ADR 0003).
- `trace-collector` (Kotlin/Ktor, new service, port 8084): consumes
  `system.trace` into a Mongo `spans` collection (not idempotent/dedup'd —
  deliberate, since spans are diagnostic, not correctness-sensitive; see ADR
  0003), fans out each consumed span to any connected SSE client via an
  in-memory `SharedFlow` (`SpanBroadcaster`). `GET /traces/{correlationId}`
  returns the full span list sorted by start time. `GET /traces/stream` is a
  manually-implemented SSE endpoint (`respondTextWriter` + `text/event-stream`
  — Ktor 2.3.12 predates the `ktor-server-sse` plugin). `GET /traces` lists
  recent traces via a Mongo aggregation grouping by correlation ID
  (start/end/span count/error status).
- Verified end-to-end manually via docker-compose: creating a venue + item
  through menu-service produces one correlation ID's worth of spans visible
  live on `GET /traces/stream` and via `GET /traces/{correlationId}`,
  spanning menu-service's HTTP entry, DB commit, and Kafka publish through
  to availability-service's Kafka consume, DB commit, and Redis write.
- ADRs: `docs/adr/0001-transactional-outbox.md`,
  `docs/adr/0002-redis-mongo-split.md`,
  `docs/adr/0003-tracing-wire-format.md` (bespoke JSON-over-Kafka wire
  format instead of adopting OpenTelemetry — reasoning and consequences in
  the ADR), `docs/adr/0004-manual-availability-override.md` (availability-
  service's manual-override endpoint writes Redis directly, bypassing
  Kafka — see below), `docs/adr/0005-observability-ui.md` (phase 5's
  additive `Span` fields, chaos endpoints living in the owning services,
  in-process duplicate-delivery replay — see below).
- `merchant-web` (React/TS/Vite, port 5173 in dev): six screens now — the
  phase 4 trio (menu editor, availability board, sync status) plus phase
  5's system x-ray: `/system/flow` (plain SVG + `requestAnimationFrame`
  live flow diagram, no graph library, driven by `trace-collector`'s SSE
  stream via a shared `useTraceStream()`/`EventSource`; edges are only
  drawn for hops that actually exist — see `docs/plan-phase5.md` "What's
  real vs. deliberately absent" — with Kafka consumer lag badges polled
  from `GET /consumer-lag`), `/system/traces` (trace list + waterfall,
  spans expandable to raw JSON including the new `idempotencyKey`/
  `kafkaPartition`/`retryCount` fields, rendered as `—` when absent),
  `/system/chaos` (pause/resume the menu.events consumer, break/restore
  Redis, inject pos-ingest latency, and force a duplicate delivery — the
  headline case, proving the dedupe check rejects a replayed event while
  item state stays unchanged). `App.tsx` is now a two-pane layout: a
  persistent compact flow diagram sits in a sidebar next to every screen
  except `/system/flow` itself (one `FlowDiagram` component, a `variant`
  prop, not two implementations), so cause and effect are visible
  together. No venue-creation/switching UI or category CRUD UI —
  menu-service has no category resource and no phase has added one; venue
  is a route param today. API types are generated (`npm run gen:api`, via
  `openapi-typescript`) from hand-written OpenAPI specs committed alongside
  each backend service (`menu-service/openapi.yaml`,
  `availability-service/openapi.yaml`, `pos-ingest/openapi.yaml`,
  `trace-collector/openapi.yaml` — nothing generates these from the
  Ktor/Go code itself yet, so keep them in sync by hand when a route
  changes); `npm run build` regenerates all four before typechecking, so a
  spec change that breaks a field/shape fails the frontend build. Playwright
  specs (`e2e/price-edit.spec.ts`, `e2e/availability-toggle.spec.ts`,
  `e2e/chaos-duplicate-delivery.spec.ts`), each reloading the page and
  asserting the change persisted server-side, not just in the client cache;
  Vitest+Testing Library tests for the conflict-banner behavior and the
  chaos duplicate-delivery card's before/after diff; a pure-function Vitest
  suite for the SSE-span-to-flow-edge mapping logic (`lib/flowGraph.ts`).
  CI: `.github/workflows/merchant-web.yml`.
- Backend additions made to support phase 5 (see `docs/adr/0005-observability-ui.md`
  for the full reasoning): `Span` (`tracing-core`'s `Span.kt` and
  `pos-ingest/internal/tracing/tracing.go`) gained three additive, optional
  fields — `idempotencyKey`, `kafkaPartition`, `retryCount` — populated only
  at the call sites that naturally have them (`MenuEventConsumer`'s
  `kafka.consume menu.events` span, `OutboxRelay`'s and pos-ingest's
  `kafka.publish` spans). `Tracer.withSpan` (Kotlin) gained an optional
  `attributes` parameter before its trailing lambda so every existing call
  site kept compiling unchanged; Go's `WithSpan` has no default params, so
  its `attrs *Attributes` parameter required updating every call site
  explicitly. `trace-collector` gained `GET /consumer-lag` (via
  `org.apache.kafka.clients.admin.AdminClient`, already on the classpath —
  no new dependency) for the two consumer groups that exist today
  (`availability-service` on `menu.events`, `trace-collector` on
  `system.trace`, configured via `MONITORED_CONSUMER_GROUPS`), plus CORS
  (previously had none — nothing called it directly from a browser before).
  `availability-service` gained a `ChaosState` (in-process, guarded by a new
  `CHAOS_ENABLED` env var, default false) wired into `MenuEventConsumer`
  (pause/resume by skipping `consumer.poll` entirely, so lag genuinely
  grows; duplicate-delivery replays the last raw record through the same
  `handleEvent` path the poll loop uses) and `RedisAvailabilityStore`
  (redis-unreachable throws before touching the `JedisPool`). `pos-ingest`'s
  `worker.Pool` gained an `injectedLatency` applied before each venue poll,
  controlled the same way. All `/chaos/*` routes 404 (not 403) when
  `CHAOS_ENABLED` is false; `docker-compose.yml` sets it `true` for both
  services since this repo has no production deployment.
- Backend additions made to support the above (menu-service and
  availability-service had no wire contract for several things this phase's
  screens needed — see `docs/plan-phase4.md` section 0 for the full audit):
  menu-service items gained `priceCents`/`sortOrder` columns, and a 409
  version-conflict response now includes the current server-side item
  (`ConflictResponse.current`) so the client doesn't need a follow-up `GET`
  to show what changed. availability-service's `AvailabilityState.available:
  Boolean` became a `status` string (`in_stock`/`sold_out`/
  `sold_out_until`) plus `soldOutUntil`, and gained
  `PUT /venues/{venueId}/items/{itemId}/availability` for merchant-
  triggered overrides — this writes straight to Redis/Mongo, bypassing
  `menu.events`/`stock.events` entirely (ADR 0004), since `stock.events`
  still has no producer or consumer. pos-ingest gained
  `POST /sync-runs/{id}/retry`, re-polling the run's venue synchronously
  through the existing (now-exported) `Pool.PollVenueNow`.
- CORS: all four services (menu-service, availability-service, pos-ingest,
  and now trace-collector as of phase 5) send CORS headers — found missing
  only once `merchant-web` was smoke-tested against a live backend in an
  actual browser, which silently blocked every cross-origin request.
  Allowed origin defaults to `localhost:5173` (Vite's default dev port),
  overridable via `CORS_ALLOWED_ORIGIN_HOST` (Kotlin services) /
  `CORS_ALLOWED_ORIGIN` (Go) env vars, set explicitly in
  `docker-compose.yml`. No gateway/reverse-proxy was introduced; each
  service answers CORS for itself.
- Verified end-to-end via a live docker-compose run this phase: every
  chaos endpoint exercised directly (duplicate-delivery correctly rejected
  with unchanged item state, lag climbing while the consumer is paused and
  draining after resume, Redis break/restore flipping the availability read
  path between 200 and 500, pos-ingest latency injection round-tripping),
  plus the actual browser UI driven via Playwright against the running
  stack — confirmed real pulses, real lag numbers, and real trace
  waterfalls with no console errors.

Not built yet:
- stock.events topic and its consumers; no consumer exists for `pos.sync`
  either. availability-service's manual-override endpoint (above) doesn't
  publish to `stock.events` either, since it doesn't exist — noted as a
  follow-up in ADR 0004 for when it does.
- Venue-creation/switching UI, category CRUD UI, pagination UI beyond
  `pos-ingest`'s `limit` query param.
- menu-service's `Prices` table (itemId, currency, amountCents,
  effectiveFrom) is still unused — item pricing is the new flat
  `items.price_cents` column instead (see `docs/plan-phase4.md` section 4.1
  for why: `Prices` has no version/optimistic-lock semantics and nothing
  routes to it).
- outbox table retention/cleanup job
- No sampling on `system.trace` — every instrumented call emits a span
  unconditionally, and `trace-collector`'s span consumer isn't dedupe'd
  (both deliberate at current scale, per ADR 0003, not oversights)
- No unit tests for `tracing-core` or `pos-ingest/internal/tracing` yet —
  verified this phase via the existing Testcontainers integration test
  (unchanged assertions, updated only for the new `Tracer` constructor
  params) plus manual docker-compose/SSE verification; no dedicated tracing
  test coverage was added
- Redis `KEYS`-based venue listing in availability-service should become a
  maintained set or `SCAN` before production traffic (noted in ADR 0002)
- pos-ingest venue-to-provider config is a static JSON file
  (`pos-ingest/venues.json`), not a DB-backed venue registry — there's no
  system-wide venue registry to query yet (venues only exist inside
  menu-service's own Postgres today)
- `docker/postgres-init.sh` was missing its executable bit, which silently
  broke `docker-compose up` for every service depending on Postgres, not
  just pos-ingest; fixed as part of this phase since it blocked verifying
  pos-ingest end-to-end
- Chaos panel's "break Redis" simulates unreachability in-process (a flag
  `RedisAvailabilityStore` checks before touching the `JedisPool`), not by
  severing the actual docker-compose network path to the `redis` container
  — deliberate, see ADR 0005's consequences section
- Chaos panel's duplicate-delivery can only replay the *last* event
  `MenuEventConsumer` processed (a single cached raw record, not a
  history) — most legible right after a real menu change, per ADR 0005
- `MONITORED_CONSUMER_GROUPS` (trace-collector's `/consumer-lag` source) is
  static config, not auto-discovered — a future `pos.sync` or
  `stock.events` consumer needs adding to it explicitly, same as
  `pos-ingest/venues.json`'s static provider config
- No sampling/backpressure on the SSE stream or the flow view — same
  stance ADR 0003 already took for `system.trace` itself
- `Span`'s new `idempotencyKey`/`kafkaPartition`/`retryCount` fields are
  populated at only two call sites total (see ADR 0005) — every other span
  leaves them null, which the trace timeline renders as `—`, not a guess
- No `Ingress`/`NetworkPolicy`/`PodDisruptionBudget`/`HorizontalPodAutoscaler`
  in `deploy/k8s/`, and no pod-level `securityContext` enforcing non-root at
  the k8s layer (only the Dockerfiles enforce it, at the image layer)
- `storefront-api` has no test coverage of its own (composition/join logic,
  `status: "unknown"` behavior, cache-aside path) — only the k6 run and
  manual docker-compose/kind verification have exercised it
- No Kotlin lint/format gate (ktlint/detekt) in CI — the four JVM services'
  only static check is compilation; deliberately deferred this phase, see
  README "Trade-offs"
- `docs/` (every ADR, every `plan-phaseN.md`) has been `.gitignore`d since
  the first commit — none of it is tracked in git, unlike CLAUDE.md itself,
  which is. Anyone cloning fresh gets CLAUDE.md but none of the ADRs or
  plans it references. Not addressed; flagged here rather than left silent