package com.clearpath.menu

import com.clearpath.menu.db.DatabaseFactory
import com.clearpath.menu.outbox.OutboxRelay
import com.clearpath.menu.repository.ItemRepository
import com.clearpath.menu.routes.itemRoutes
import com.clearpath.tracing.Tracer
import com.clearpath.tracing.installTracing
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.server.metrics.micrometer.MicrometerMetrics
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.application.Application
import io.ktor.server.application.install
import io.ktor.server.engine.embeddedServer
import io.ktor.server.netty.Netty
import io.ktor.server.application.call
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import io.ktor.server.plugins.cors.routing.CORS
import io.ktor.server.response.respond
import io.ktor.server.routing.get
import io.ktor.server.routing.routing
import io.micrometer.core.instrument.Gauge
import io.micrometer.core.instrument.distribution.DistributionStatisticConfig
import io.micrometer.prometheusmetrics.PrometheusConfig
import io.micrometer.prometheusmetrics.PrometheusMeterRegistry
import kotlinx.serialization.json.Json

fun main() {
    val config = AppConfig()
    val db = DatabaseFactory.connect(config)
    val tracer = Tracer("menu-service", config.kafkaBootstrapServers, config.systemTraceTopic)

    val relay = OutboxRelay(config, db, tracer)

    embeddedServer(Netty, port = config.httpPort) {
        moduleWith(db, relay, tracer)
    }.start(wait = true)
}

fun Application.moduleWith(db: org.jetbrains.exposed.sql.Database, relay: OutboxRelay, tracer: Tracer) {
    val registry = PrometheusMeterRegistry(PrometheusConfig.DEFAULT)
    install(MicrometerMetrics) {
        this.registry = registry
        // Real histogram buckets (not just count/sum/max) so p50/p95/p99 are computable in
        // Grafana via histogram_quantile() — see deploy/grafana/clearpath-dashboard.json.
        distributionStatisticConfig = DistributionStatisticConfig.Builder()
            .percentilesHistogram(true)
            .build()
    }

    install(ContentNegotiation) {
        json(Json { ignoreUnknownKeys = true })
    }
    // merchant-web (a browser app on its own origin, e.g. the Vite dev server) calls this
    // service directly - there's no gateway/reverse-proxy in front of it - so it needs an
    // explicit CORS policy or every cross-origin fetch is blocked before it reaches routing.
    install(CORS) {
        allowHost(
            System.getenv("CORS_ALLOWED_ORIGIN_HOST") ?: "localhost:5173",
            schemes = listOf("http", "https"),
        )
        allowMethod(HttpMethod.Get)
        allowMethod(HttpMethod.Post)
        allowMethod(HttpMethod.Put)
        allowMethod(HttpMethod.Delete)
        allowHeader(HttpHeaders.ContentType)
        allowHeader("X-Correlation-Id")
    }
    installTracing(tracer)

    relay.start(this)

    val repository = ItemRepository(db, tracer)

    // Outbox backlog depth: rows not yet relayed to Kafka. A growing value means the relay is
    // falling behind (or stopped) — see docs/adr/0001-transactional-outbox.md.
    Gauge.builder("menu_outbox_backlog") { repository.outboxBacklogCount() }
        .description("Outbox rows not yet published to menu.events")
        .register(registry)

    routing {
        get("/health") { call.respond(mapOf("status" to "ok")) }
        get("/ready") { call.respond(mapOf("status" to "ok")) }
        get("/metrics") { call.respond(registry.scrape()) }

        itemRoutes(repository)
    }
}
