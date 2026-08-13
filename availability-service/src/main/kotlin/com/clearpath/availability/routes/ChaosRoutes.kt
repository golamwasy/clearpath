package com.clearpath.availability.routes

import com.clearpath.availability.AppConfig
import com.clearpath.availability.chaos.ChaosState
import com.clearpath.availability.consumer.MenuEventConsumer
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.ApplicationCall
import io.ktor.server.application.call
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.route
import kotlinx.serialization.Serializable

@Serializable
data class ChaosStateResponse(val consumerPaused: Boolean, val redisUnreachable: Boolean)

@Serializable
data class DuplicateDeliveryResponse(
    val eventId: String?,
    val itemId: String?,
    val correlationId: String?,
    val accepted: Boolean,
    val reason: String,
)

/** Responds 404 and returns true if chaos endpoints are disabled — the caller should return without proceeding. */
private suspend fun ApplicationCall.rejectIfChaosDisabled(config: AppConfig): Boolean {
    if (!config.chaosEnabled) {
        respond(HttpStatusCode.NotFound)
        return true
    }
    return false
}

/**
 * Chaos-panel control surface: pause/resume the menu.events consumer, break/restore Redis, and
 * force a duplicate delivery. Every route 404s (not 403s, so the surface isn't advertised) unless
 * CHAOS_ENABLED=true. See docs/adr/0005-observability-ui.md.
 */
fun Route.chaosRoutes(config: AppConfig, chaosState: ChaosState, consumer: MenuEventConsumer) {
    route("/chaos") {
        get("/state") {
            if (call.rejectIfChaosDisabled(config)) return@get
            call.respond(ChaosStateResponse(chaosState.consumerPaused.get(), chaosState.redisUnreachable.get()))
        }

        post("/consumer/pause") {
            if (call.rejectIfChaosDisabled(config)) return@post
            chaosState.consumerPaused.set(true)
            call.respond(ChaosStateResponse(chaosState.consumerPaused.get(), chaosState.redisUnreachable.get()))
        }

        post("/consumer/resume") {
            if (call.rejectIfChaosDisabled(config)) return@post
            chaosState.consumerPaused.set(false)
            call.respond(ChaosStateResponse(chaosState.consumerPaused.get(), chaosState.redisUnreachable.get()))
        }

        post("/redis/break") {
            if (call.rejectIfChaosDisabled(config)) return@post
            chaosState.redisUnreachable.set(true)
            call.respond(ChaosStateResponse(chaosState.consumerPaused.get(), chaosState.redisUnreachable.get()))
        }

        post("/redis/restore") {
            if (call.rejectIfChaosDisabled(config)) return@post
            chaosState.redisUnreachable.set(false)
            call.respond(ChaosStateResponse(chaosState.consumerPaused.get(), chaosState.redisUnreachable.get()))
        }

        post("/duplicate-delivery") {
            if (call.rejectIfChaosDisabled(config)) return@post
            val outcome = consumer.replayLastEvent()
            if (outcome == null) {
                call.respond(
                    HttpStatusCode.NotFound,
                    DuplicateDeliveryResponse(null, null, null, accepted = false, reason = "no event processed yet"),
                )
            } else {
                call.respond(
                    HttpStatusCode.OK,
                    DuplicateDeliveryResponse(
                        outcome.eventId,
                        outcome.itemId,
                        outcome.correlationId,
                        outcome.accepted,
                        outcome.reason,
                    ),
                )
            }
        }
    }
}
