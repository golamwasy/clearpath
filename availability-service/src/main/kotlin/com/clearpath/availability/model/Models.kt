package com.clearpath.availability.model

import kotlinx.serialization.Serializable

@Serializable
data class MenuEvent(
    val eventId: String,
    val eventType: String,
    val venueId: String,
    val itemId: String,
    val version: Int,
    val correlationId: String,
    val occurredAt: String,
)

/** One of "in_stock", "sold_out", "sold_out_until" — a plain string, not an enum, matching how MenuEvent.eventType is modeled elsewhere in this repo. */
object AvailabilityStatus {
    const val IN_STOCK = "in_stock"
    const val SOLD_OUT = "sold_out"
    const val SOLD_OUT_UNTIL = "sold_out_until"

    val ALL = setOf(IN_STOCK, SOLD_OUT, SOLD_OUT_UNTIL)
}

@Serializable
data class AvailabilityState(
    val venueId: String,
    val itemId: String,
    val status: String,
    val soldOutUntil: String? = null,
    val version: Int,
    val updatedAt: String,
)

@Serializable
data class AvailabilityResponse(val items: List<AvailabilityState>)

@Serializable
data class UpdateAvailabilityRequest(
    val status: String,
    val soldOutUntil: String? = null,
)
