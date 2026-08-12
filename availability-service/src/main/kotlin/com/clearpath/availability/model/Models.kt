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

@Serializable
data class AvailabilityState(
    val venueId: String,
    val itemId: String,
    val available: Boolean,
    val version: Int,
    val updatedAt: String,
)

@Serializable
data class AvailabilityResponse(val items: List<AvailabilityState>)
