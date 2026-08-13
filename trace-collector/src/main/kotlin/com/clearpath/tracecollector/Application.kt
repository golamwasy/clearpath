package com.clearpath.tracecollector

import com.clearpath.tracecollector.consumer.SpanConsumer
import com.clearpath.tracecollector.lag.KafkaLagService
import com.clearpath.tracecollector.lag.parseMonitoredGroups
import com.clearpath.tracecollector.routes.lagRoutes
import com.clearpath.tracecollector.routes.traceRoutes
import com.clearpath.tracecollector.sse.SpanBroadcaster
import com.clearpath.tracecollector.store.SpanStore
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
import org.apache.kafka.clients.admin.AdminClient
import org.apache.kafka.clients.admin.AdminClientConfig
import java.util.Properties

fun main() {
    val config = AppConfig()

    val mongoClient = MongoClient.create(config.mongoUri)
    val mongoDatabase = mongoClient.getDatabase(config.mongoDatabase)

    val store = SpanStore(mongoDatabase)
    val broadcaster = SpanBroadcaster()
    val consumer = SpanConsumer(config, store, broadcaster)

    val adminProps = Properties().apply { put(AdminClientConfig.BOOTSTRAP_SERVERS_CONFIG, config.kafkaBootstrapServers) }
    val lagService = KafkaLagService(AdminClient.create(adminProps), parseMonitoredGroups(config.monitoredConsumerGroups))

    embeddedServer(Netty, port = config.httpPort) {
        moduleWith(consumer, store, broadcaster, lagService)
    }.start(wait = true)
}

fun Application.moduleWith(consumer: SpanConsumer, store: SpanStore, broadcaster: SpanBroadcaster, lagService: KafkaLagService) {
    install(ContentNegotiation) {
        json(Json { ignoreUnknownKeys = true })
    }
    // See availability-service's Application.kt for why this is needed: merchant-web calls this
    // service directly from its own origin, with no gateway in front.
    install(CORS) {
        allowHost(
            System.getenv("CORS_ALLOWED_ORIGIN_HOST") ?: "localhost:5173",
            schemes = listOf("http", "https"),
        )
        allowMethod(HttpMethod.Get)
        allowHeader(HttpHeaders.ContentType)
        allowHeader("X-Correlation-Id")
    }

    consumer.start(this)

    routing {
        get("/health") { call.respond(mapOf("status" to "ok")) }
        get("/ready") { call.respond(mapOf("status" to "ok")) }
        get("/metrics") { call.respond("# not implemented\n") }

        traceRoutes(store, broadcaster)
        lagRoutes(lagService)
    }
}
