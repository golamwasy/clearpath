package com.clearpath.storefront.routes

import com.clearpath.storefront.service.MenuCompositionService
import com.clearpath.tracing.ErrorResponse
import com.clearpath.tracing.traceContext
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.route

fun Route.storefrontRoutes(composition: MenuCompositionService) {
    route("/venues/{venueId}/menu") {
        get {
            val venueId = call.parameters["venueId"]
                ?: return@get call.respond(HttpStatusCode.BadRequest, ErrorResponse("bad_request", "invalid venueId"))
            call.respond(HttpStatusCode.OK, composition.getMenu(venueId, call.traceContext))
        }
    }
}
