package com.clearpath.availability.routes

import com.clearpath.availability.model.AvailabilityResponse
import com.clearpath.availability.state.RedisAvailabilityStore
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.route

fun Route.availabilityRoutes(store: RedisAvailabilityStore) {
    route("/venues/{venueId}/availability") {
        get {
            val venueId = call.parameters["venueId"]
                ?: return@get call.respond(HttpStatusCode.BadRequest, mapOf("error" to "invalid venueId"))
            call.respond(HttpStatusCode.OK, AvailabilityResponse(store.listForVenue(venueId)))
        }
    }
}
