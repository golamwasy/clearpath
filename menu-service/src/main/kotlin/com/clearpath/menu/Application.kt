package com.clearpath.menu

import com.clearpath.menu.db.DatabaseFactory
import com.clearpath.menu.outbox.OutboxRelay
import com.clearpath.menu.repository.ItemRepository
import com.clearpath.menu.routes.itemRoutes
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.application.Application
import io.ktor.server.application.install
import io.ktor.server.engine.embeddedServer
import io.ktor.server.netty.Netty
import io.ktor.server.application.call
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import io.ktor.server.response.respond
import io.ktor.server.routing.get
import io.ktor.server.routing.routing
import kotlinx.serialization.json.Json

fun main() {
    val config = AppConfig()
    val db = DatabaseFactory.connect(config)

    val relay = OutboxRelay(config, db)

    embeddedServer(Netty, port = config.httpPort) {
        moduleWith(db, relay)
    }.start(wait = true)
}

fun Application.moduleWith(db: org.jetbrains.exposed.sql.Database, relay: OutboxRelay) {
    install(ContentNegotiation) {
        json(Json { ignoreUnknownKeys = true })
    }
    install(CorrelationIdPlugin)

    relay.start(this)

    val repository = ItemRepository(db)

    routing {
        get("/health") { call.respond(mapOf("status" to "ok")) }
        get("/ready") { call.respond(mapOf("status" to "ok")) }
        get("/metrics") { call.respond("# not implemented\n") }

        itemRoutes(repository)
    }
}
