package com.clearpath.menu.routes

import com.clearpath.menu.model.CreateItemRequest
import com.clearpath.menu.model.ErrorResponse
import com.clearpath.menu.model.UpdateItemRequest
import com.clearpath.menu.model.VenueRequest
import com.clearpath.menu.model.VenueResponse
import com.clearpath.menu.repository.ItemRepository
import com.clearpath.menu.repository.ItemWriteResult
import com.clearpath.tracing.traceContext
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.delete
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.put
import io.ktor.server.routing.route
import java.util.UUID

fun Route.itemRoutes(repository: ItemRepository) {
    route("/venues") {
        post {
            val request = call.receive<VenueRequest>()
            val id = repository.createVenue(request.name)
            call.respond(HttpStatusCode.Created, VenueResponse(id, request.name))
        }

        route("/{venueId}/items") {
            post {
                val venueId = call.parameters["venueId"]?.let(UUID::fromString)
                    ?: return@post call.respond(HttpStatusCode.BadRequest, ErrorResponse("bad_request", "invalid venueId"))
                val request = call.receive<CreateItemRequest>()

                when (val result = repository.create(venueId, request, call.traceContext)) {
                    is ItemWriteResult.Success -> call.respond(HttpStatusCode.Created, result.item)
                    is ItemWriteResult.NotFound -> call.respond(HttpStatusCode.NotFound, ErrorResponse("not_found", "venue not found"))
                    is ItemWriteResult.VersionConflict -> call.respond(HttpStatusCode.Conflict, ErrorResponse("version_conflict", "unexpected"))
                }
            }

            get {
                val venueId = call.parameters["venueId"]?.let(UUID::fromString)
                    ?: return@get call.respond(HttpStatusCode.BadRequest, ErrorResponse("bad_request", "invalid venueId"))
                call.respond(HttpStatusCode.OK, repository.list(venueId))
            }

            route("/{itemId}") {
                put {
                    val venueId = call.parameters["venueId"]?.let(UUID::fromString)
                        ?: return@put call.respond(HttpStatusCode.BadRequest, ErrorResponse("bad_request", "invalid venueId"))
                    val itemId = call.parameters["itemId"]?.let(UUID::fromString)
                        ?: return@put call.respond(HttpStatusCode.BadRequest, ErrorResponse("bad_request", "invalid itemId"))
                    val request = call.receive<UpdateItemRequest>()

                    when (val result = repository.update(venueId, itemId, request, call.traceContext)) {
                        is ItemWriteResult.Success -> call.respond(HttpStatusCode.OK, result.item)
                        is ItemWriteResult.NotFound -> call.respond(HttpStatusCode.NotFound, ErrorResponse("not_found", "item not found"))
                        is ItemWriteResult.VersionConflict -> call.respond(
                            HttpStatusCode.Conflict,
                            ErrorResponse("version_conflict", "item was modified concurrently"),
                        )
                    }
                }

                delete {
                    val venueId = call.parameters["venueId"]?.let(UUID::fromString)
                        ?: return@delete call.respond(HttpStatusCode.BadRequest, ErrorResponse("bad_request", "invalid venueId"))
                    val itemId = call.parameters["itemId"]?.let(UUID::fromString)
                        ?: return@delete call.respond(HttpStatusCode.BadRequest, ErrorResponse("bad_request", "invalid itemId"))
                    val version = call.request.queryParameters["version"]?.toIntOrNull()
                        ?: return@delete call.respond(HttpStatusCode.BadRequest, ErrorResponse("bad_request", "version query param required"))

                    when (val result = repository.delete(venueId, itemId, version, call.traceContext)) {
                        is ItemWriteResult.Success -> call.respond(HttpStatusCode.NoContent)
                        is ItemWriteResult.NotFound -> call.respond(HttpStatusCode.NotFound, ErrorResponse("not_found", "item not found"))
                        is ItemWriteResult.VersionConflict -> call.respond(
                            HttpStatusCode.Conflict,
                            ErrorResponse("version_conflict", "item was modified concurrently"),
                        )
                    }
                }
            }
        }
    }
}
