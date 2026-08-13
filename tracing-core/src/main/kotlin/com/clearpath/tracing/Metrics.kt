package com.clearpath.tracing

import io.ktor.server.application.Application
import io.ktor.server.application.call
import io.ktor.server.application.install
import io.ktor.server.metrics.micrometer.MicrometerMetrics
import io.ktor.server.response.respond
import io.ktor.server.routing.get
import io.ktor.server.routing.routing
import io.micrometer.core.instrument.distribution.DistributionStatisticConfig
import io.micrometer.prometheusmetrics.PrometheusConfig
import io.micrometer.prometheusmetrics.PrometheusMeterRegistry

/**
 * Installs Micrometer with real histogram buckets (not just count/sum/max, so p50/p95/p99 are
 * computable in Grafana via `histogram_quantile()` — see deploy/grafana/clearpath-dashboard.json)
 * and returns the registry so the caller can wire its own [installStandardRoutes] `/metrics`
 * route, or scrape it some other way (e.g. a per-group gauge, as trace-collector's `/consumer-lag`
 * source does). Pulled out here because every one of this repo's Kotlin services installed the
 * identical block independently — CLAUDE.md's own "every service exposes /health, /ready,
 * /metrics" convention already assumes this is uniform across services.
 */
fun Application.installMetrics(): PrometheusMeterRegistry {
    val registry = PrometheusMeterRegistry(PrometheusConfig.DEFAULT)
    install(MicrometerMetrics) {
        this.registry = registry
        distributionStatisticConfig = DistributionStatisticConfig.Builder()
            .percentilesHistogram(true)
            .build()
    }
    return registry
}

/** The `/health`, `/ready`, `/metrics` trio every service exposes, per CLAUDE.md's conventions. */
fun Application.installStandardRoutes(registry: PrometheusMeterRegistry) {
    routing {
        get("/health") { call.respond(mapOf("status" to "ok")) }
        get("/ready") { call.respond(mapOf("status" to "ok")) }
        get("/metrics") { call.respond(registry.scrape()) }
    }
}
