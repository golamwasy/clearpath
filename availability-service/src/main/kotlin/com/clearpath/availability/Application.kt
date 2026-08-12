package com.clearpath.availability

import com.clearpath.availability.audit.MongoAuditStore
import com.clearpath.availability.consumer.MenuEventConsumer
import com.clearpath.availability.db.DatabaseFactory
import com.clearpath.availability.idempotency.IdempotencyStore
import com.clearpath.availability.routes.availabilityRoutes
import com.clearpath.availability.state.RedisAvailabilityStore
import com.clearpath.tracing.Tracer
import com.clearpath.tracing.installTracing
import com.mongodb.kotlin.client.coroutine.MongoClient
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.application.Application
import io.ktor.server.application.call
import io.ktor.server.application.install
import io.ktor.server.engine.embeddedServer
import io.ktor.server.netty.Netty
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import io.ktor.server.plugins.cors.routing.CORS
import io.ktor.server.response.respond
import io.ktor.server.routing.get
import io.ktor.server.routing.routing
import kotlinx.serialization.json.Json
import redis.clients.jedis.JedisPool

fun main() {
    val config = AppConfig()
    val db = DatabaseFactory.connect(config)
    val tracer = Tracer("availability-service", config.kafkaBootstrapServers, config.systemTraceTopic)

    val jedisPool = JedisPool(config.redisHost, config.redisPort)
    val mongoClient = MongoClient.create(config.mongoUri)
    val mongoDatabase = mongoClient.getDatabase(config.mongoDatabase)

    val redisStore = RedisAvailabilityStore(jedisPool, tracer)
    val auditStore = MongoAuditStore(mongoDatabase)
    val idempotencyStore = IdempotencyStore(db, tracer)
    val consumer = MenuEventConsumer(config, idempotencyStore, redisStore, auditStore, tracer)

    embeddedServer(Netty, port = config.httpPort) {
        moduleWith(consumer, redisStore, auditStore, tracer)
    }.start(wait = true)
}

fun Application.moduleWith(consumer: MenuEventConsumer, redisStore: RedisAvailabilityStore, auditStore: MongoAuditStore, tracer: Tracer) {
    install(ContentNegotiation) {
        json(Json { ignoreUnknownKeys = true })
    }
    // See menu-service's Application.kt for why this is needed: merchant-web calls this
    // service directly from its own origin, with no gateway in front.
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

    consumer.start(this)

    routing {
        get("/health") { call.respond(mapOf("status" to "ok")) }
        get("/ready") { call.respond(mapOf("status" to "ok")) }
        get("/metrics") { call.respond("# not implemented\n") }

        availabilityRoutes(redisStore, auditStore)
    }
}
