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

Phase: 3 (distributed tracing)

Working:
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
  the ADR).

Not built yet:
- storefront-api
- merchant-web frontend (no UI was built this phase, per instructions —
  `trace-collector`'s REST/SSE API is the surface a future frontend phase
  would read)
- stock.events topic and its consumers; no consumer exists for `pos.sync`
  either
- /metrics on all four services (now including trace-collector) is a stub
  (returns a placeholder, not real Prometheus output)
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