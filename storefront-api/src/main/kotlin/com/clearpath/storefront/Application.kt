package com.clearpath.storefront

import com.clearpath.storefront.cache.MenuCacheStore
import com.clearpath.storefront.client.AvailabilityServiceClient
import com.clearpath.storefront.client.MenuServiceClient
import com.clearpath.storefront.model.ErrorResponse
import com.clearpath.storefront.routes.storefrontRoutes
import com.clearpath.storefront.service.MenuCompositionService
import com.clearpath.tracing.Tracer
import com.clearpath.tracing.installTracing
import io.ktor.client.HttpClient
import io.ktor.client.engine.cio.CIO
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation as ClientContentNegotiation
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.application.Application
import io.ktor.server.application.call
import io.ktor.server.application.install
import io.ktor.server.engine.embeddedServer
import io.ktor.server.metrics.micrometer.MicrometerMetrics
import io.ktor.server.netty.Netty
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import io.ktor.server.plugins.cors.routing.CORS
import io.ktor.server.plugins.statuspages.StatusPages
import io.ktor.server.response.respond
import io.ktor.server.routing.get
import io.ktor.server.routing.routing
import io.micrometer.core.instrument.distribution.DistributionStatisticConfig
import io.micrometer.prometheusmetrics.PrometheusConfig
import io.micrometer.prometheusmetrics.PrometheusMeterRegistry
import kotlinx.serialization.json.Json
import redis.clients.jedis.JedisPool

fun main() {
    val config = AppConfig()
    val tracer = Tracer("storefront-api", config.kafkaBootstrapServers, config.systemTraceTopic)

    val httpClient = HttpClient(CIO) {
        install(ClientContentNegotiation) {
            json(Json { ignoreUnknownKeys = true })
        }
    }
    val menuClient = MenuServiceClient(httpClient, config.menuServiceUrl)
    val availabilityClient = AvailabilityServiceClient(httpClient, config.availabilityServiceUrl)

    val jedisPool = JedisPool(config.redisHost, config.redisPort)
    val cache = MenuCacheStore(jedisPool, config.menuCacheTtlSeconds)

    val composition = MenuCompositionService(menuClient, availabilityClient, cache, tracer)

    embeddedServer(Netty, port = config.httpPort) {
        moduleWith(tracer, composition)
    }.start(wait = true)
}

fun Application.moduleWith(tracer: Tracer, composition: MenuCompositionService) {
    val registry = PrometheusMeterRegistry(PrometheusConfig.DEFAULT)
    install(MicrometerMetrics) {
        this.registry = registry
        distributionStatisticConfig = DistributionStatisticConfig.Builder()
            .percentilesHistogram(true)
            .build()
    }

    install(ContentNegotiation) {
        json(Json { ignoreUnknownKeys = true })
    }
    // See menu-service's Application.kt for why this is needed: merchant-web (and, per this
    // phase's k6 script) calls this service directly from its own origin, with no gateway
    // in front.
    install(CORS) {
        allowHost(
            System.getenv("CORS_ALLOWED_ORIGIN_HOST") ?: "localhost:5173",
            schemes = listOf("http", "https"),
        )
        allowMethod(HttpMethod.Get)
        allowHeader(HttpHeaders.ContentType)
        allowHeader("X-Correlation-Id")
    }
    // menu-service/availability-service being unreachable or erroring is the one failure mode
    // unique to this service (it composes, it doesn't own data) — surfaced as 502 rather than
    // letting Ktor's default 500 hide which upstream failed.
    install(StatusPages) {
        exception<Exception> { call, cause ->
            call.respond(HttpStatusCode.BadGateway, ErrorResponse("upstream_error", cause.message ?: "upstream call failed"))
        }
    }
    installTracing(tracer)

    routing {
        get("/health") { call.respond(mapOf("status" to "ok")) }
        get("/ready") { call.respond(mapOf("status" to "ok")) }
        get("/metrics") { call.respond(registry.scrape()) }

        storefrontRoutes(composition)
    }
}
