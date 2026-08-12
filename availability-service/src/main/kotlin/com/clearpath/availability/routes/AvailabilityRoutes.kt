package com.clearpath.availability.routes

import com.clearpath.availability.audit.MongoAuditStore
import com.clearpath.availability.model.AvailabilityResponse
import com.clearpath.availability.model.AvailabilityState
import com.clearpath.availability.model.AvailabilityStatus
import com.clearpath.availability.model.ErrorResponse
import com.clearpath.availability.model.UpdateAvailabilityRequest
import com.clearpath.availability.state.RedisAvailabilityStore
import com.clearpath.tracing.traceContext
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.put
import io.ktor.server.routing.route
import java.time.Instant

fun Route.availabilityRoutes(store: RedisAvailabilityStore, auditStore: MongoAuditStore) {
    route("/venues/{venueId}/availability") {
        get {
            val venueId = call.parameters["venueId"]
                ?: return@get call.respond(HttpStatusCode.BadRequest, ErrorResponse("bad_request", "invalid venueId"))
            call.respond(HttpStatusCode.OK, AvailabilityResponse(store.listForVenue(venueId)))
        }
    }

    route("/venues/{venueId}/items/{itemId}/availability") {
        put {
            val venueId = call.parameters["venueId"]
                ?: return@put call.respond(HttpStatusCode.BadRequest, ErrorResponse("bad_request", "invalid venueId"))
            val itemId = call.parameters["itemId"]
                ?: return@put call.respond(HttpStatusCode.BadRequest, ErrorResponse("bad_request", "invalid itemId"))
            val request = call.receive<UpdateAvailabilityRequest>()

            if (request.status !in AvailabilityStatus.ALL) {
                return@put call.respond(
                    HttpStatusCode.BadRequest,
                    ErrorResponse("bad_request", "status must be one of ${AvailabilityStatus.ALL}"),
                )
            }
            if (request.status == AvailabilityStatus.SOLD_OUT_UNTIL && request.soldOutUntil == null) {
                return@put call.respond(
                    HttpStatusCode.BadRequest,
                    ErrorResponse("bad_request", "soldOutUntil is required when status is sold_out_until"),
                )
            }
            val soldOutUntil = if (request.status == AvailabilityStatus.SOLD_OUT_UNTIL) request.soldOutUntil else null

            // version is carried forward from the last menu.events-derived state, not incremented -
            // a manual override is a separate axis from the item's own version. See ADR 0004.
            val previousVersion = store.get(venueId, itemId)?.version ?: 0

            val state = AvailabilityState(
                venueId = venueId,
                itemId = itemId,
                status = request.status,
                soldOutUntil = soldOutUntil,
                version = previousVersion,
                updatedAt = Instant.now().toString(),
            )

            store.put(state, call.traceContext)
            auditStore.appendManualOverride(venueId, itemId, request.status, soldOutUntil, call.traceContext.correlationId)

            call.respond(HttpStatusCode.OK, state)
        }
    }
}
