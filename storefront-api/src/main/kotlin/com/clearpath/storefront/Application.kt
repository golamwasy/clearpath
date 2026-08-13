package com.clearpath.storefront

import com.clearpath.storefront.cache.MenuCacheStore
import com.clearpath.storefront.client.AvailabilityServiceClient
import com.clearpath.storefront.client.MenuServiceClient
import com.clearpath.storefront.errors.CacheException
import com.clearpath.storefront.errors.UpstreamServiceException
import com.clearpath.storefront.routes.storefrontRoutes
import com.clearpath.storefront.service.MenuCompositionService
import com.clearpath.tracing.ErrorResponse
import com.clearpath.tracing.Tracer
import com.clearpath.tracing.installMetrics
import com.clearpath.tracing.installStandardRoutes
import com.clearpath.tracing.installTracing
import io.ktor.client.HttpClient
import io.ktor.client.engine.cio.CIO
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation as ClientContentNegotiation
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.application.Application
import io.ktor.server.application.install
import io.ktor.server.engine.embeddedServer
import io.ktor.server.netty.Netty
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import io.ktor.server.plugins.cors.routing.CORS
import io.ktor.server.plugins.statuspages.StatusPages
import io.ktor.server.response.respond
import io.ktor.server.routing.routing
import kotlinx.serialization.json.Json
import redis.clients.jedis.JedisPool

fun main() {
    val config = AppConfig()
    val tracer = Tracer("storefront-api", config.kafkaBootstrapServers, config.systemTraceTopic)

    val httpClient = HttpClient(CIO) {
        install(ClientContentNegotiation) {
            json(Json { ignoreUnknownKeys = true })
        }
        // Without this, a slow (not down) upstream hangs the request indefinitely instead of ever
        // reaching the 502 the StatusPages handler below is supposed to guarantee.
        install(HttpTimeout) {
            requestTimeoutMillis = config.upstreamTimeoutMs
            connectTimeoutMillis = config.upstreamTimeoutMs
            socketTimeoutMillis = config.upstreamTimeoutMs
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
    val registry = installMetrics()

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
    // unique to this service (it composes, it doesn't own data) — surfaced as 502 naming which
    // upstream failed, rather than letting Ktor's default 500 (or a single undifferentiated 502)
    // hide it. A legitimate non-2xx from an upstream (e.g. 404 for an unknown venue) is forwarded
    // as-is instead of flattened into a 502, since that's not storefront-api or its upstream being
    // broken.
    install(StatusPages) {
        exception<UpstreamServiceException> { call, cause ->
            val forwardedStatus = cause.upstreamStatus?.let { HttpStatusCode.fromValue(it) }
            if (forwardedStatus != null) {
                call.respond(forwardedStatus, ErrorResponse("upstream_${cause.service.replace('-', '_')}_error", cause.message ?: "upstream error"))
            } else {
                call.respond(HttpStatusCode.BadGateway, ErrorResponse("upstream_${cause.service.replace('-', '_')}_error", cause.message ?: "upstream call failed"))
            }
        }
        exception<CacheException> { call, cause ->
            call.respond(HttpStatusCode.BadGateway, ErrorResponse("cache_error", cause.message ?: "cache call failed"))
        }
        exception<Exception> { call, cause ->
            call.respond(HttpStatusCode.BadGateway, ErrorResponse("upstream_error", cause.message ?: "upstream call failed"))
        }
    }
    installTracing(tracer)

    installStandardRoutes(registry)

    routing {
        storefrontRoutes(composition)
    }
}
