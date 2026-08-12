package com.clearpath.tracecollector

import com.clearpath.tracecollector.consumer.SpanConsumer
import com.clearpath.tracecollector.routes.traceRoutes
import com.clearpath.tracecollector.sse.SpanBroadcaster
import com.clearpath.tracecollector.store.SpanStore
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

fun main() {
    val config = AppConfig()

    val mongoClient = MongoClient.create(config.mongoUri)
    val mongoDatabase = mongoClient.getDatabase(config.mongoDatabase)

    val store = SpanStore(mongoDatabase)
    val broadcaster = SpanBroadcaster()
    val consumer = SpanConsumer(config, store, broadcaster)

    embeddedServer(Netty, port = config.httpPort) {
        moduleWith(consumer, store, broadcaster)
    }.start(wait = true)
}

fun Application.moduleWith(consumer: SpanConsumer, store: SpanStore, broadcaster: SpanBroadcaster) {
    install(ContentNegotiation) {
        json(Json { ignoreUnknownKeys = true })
    }

    consumer.start(this)

    routing {
        get("/health") { call.respond(mapOf("status" to "ok")) }
        get("/ready") { call.respond(mapOf("status" to "ok")) }
        get("/metrics") { call.respond("# not implemented\n") }

        traceRoutes(store, broadcaster)
    }
}
