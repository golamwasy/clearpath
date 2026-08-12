package com.clearpath.availability

import com.clearpath.availability.audit.MongoAuditStore
import com.clearpath.availability.consumer.MenuEventConsumer
import com.clearpath.availability.db.DatabaseFactory
import com.clearpath.availability.idempotency.IdempotencyStore
import com.clearpath.availability.routes.availabilityRoutes
import com.clearpath.availability.state.RedisAvailabilityStore
import com.mongodb.kotlin.client.coroutine.MongoClient
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.application.Application
import io.ktor.server.application.call
import io.ktor.server.application.install
import io.ktor.server.engine.embeddedServer
import io.ktor.server.netty.Netty
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import io.ktor.server.response.respond
import io.ktor.server.routing.get
import io.ktor.server.routing.routing
import kotlinx.serialization.json.Json
import redis.clients.jedis.JedisPool

fun main() {
    val config = AppConfig()
    val db = DatabaseFactory.connect(config)

    val jedisPool = JedisPool(config.redisHost, config.redisPort)
    val mongoClient = MongoClient.create(config.mongoUri)
    val mongoDatabase = mongoClient.getDatabase(config.mongoDatabase)

    val redisStore = RedisAvailabilityStore(jedisPool)
    val auditStore = MongoAuditStore(mongoDatabase)
    val idempotencyStore = IdempotencyStore(db)
    val consumer = MenuEventConsumer(config, idempotencyStore, redisStore, auditStore)

    embeddedServer(Netty, port = config.httpPort) {
        moduleWith(consumer, redisStore)
    }.start(wait = true)
}

fun Application.moduleWith(consumer: MenuEventConsumer, redisStore: RedisAvailabilityStore) {
    install(ContentNegotiation) {
        json(Json { ignoreUnknownKeys = true })
    }

    consumer.start(this)

    routing {
        get("/health") { call.respond(mapOf("status" to "ok")) }
        get("/ready") { call.respond(mapOf("status" to "ok")) }
        get("/metrics") { call.respond("# not implemented\n") }

        availabilityRoutes(redisStore)
    }
}
