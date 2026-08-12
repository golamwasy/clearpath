package com.clearpath.tracecollector.routes

import com.clearpath.tracecollector.sse.SpanBroadcaster
import com.clearpath.tracecollector.store.SpanStore
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.server.application.call
import io.ktor.server.response.header
import io.ktor.server.response.respond
import io.ktor.server.response.respondTextWriter
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.route
import kotlinx.coroutines.flow.collect
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

fun Route.traceRoutes(store: SpanStore, broadcaster: SpanBroadcaster) {
    val json = Json { ignoreUnknownKeys = true }

    route("/traces") {
        get("/stream") {
            call.response.header(HttpHeaders.CacheControl, "no-cache")
            call.respondTextWriter(contentType = ContentType.Text.EventStream) {
                broadcaster.spans.collect { span ->
                    write("data: ${json.encodeToString(span)}\n\n")
                    flush()
                }
            }
        }

        get("/{correlationId}") {
            val correlationId = call.parameters["correlationId"]!!
            call.respond(store.findByCorrelationId(correlationId))
        }

        get {
            val limit = call.request.queryParameters["limit"]?.toIntOrNull() ?: 50
            call.respond(store.recentTraces(limit))
        }
    }
}
