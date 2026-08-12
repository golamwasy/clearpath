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

Phase: 2 (POS ingestion)

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
- ADRs: `docs/adr/0001-transactional-outbox.md`,
  `docs/adr/0002-redis-mongo-split.md`.

Not built yet:
- storefront-api
- trace-collector / system.trace / correlation ID propagation across Kafka
  headers beyond menu.events and pos.sync (correlation ID does propagate
  over HTTP, into the outbox->Kafka hop, and into pos-ingest's Kafka
  publishes as headers, but there's no collector consuming it yet)
- merchant-web frontend
- stock.events topic and its consumers; no consumer exists for `pos.sync`
  either (menu-service and availability-service are unchanged this phase)
- /metrics on all three services is a stub (returns a placeholder, not real
  Prometheus output)
- outbox table retention/cleanup job
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