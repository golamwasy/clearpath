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

Phase: <update this after each phase>
Working: <list>
Not built yet: <list>