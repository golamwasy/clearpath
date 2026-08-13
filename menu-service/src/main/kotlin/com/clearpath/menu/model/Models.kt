package com.clearpath.menu.model

import kotlinx.serialization.Serializable

@Serializable
data class VenueRequest(val name: String)

@Serializable
data class VenueResponse(val id: String, val name: String)

@Serializable
data class CreateItemRequest(
    val categoryId: String? = null,
    val name: String,
    val description: String? = null,
    val priceCents: Long? = null,
    val sortOrder: Int = 0,
)

@Serializable
data class UpdateItemRequest(
    val version: Int,
    val name: String,
    val description: String? = null,
    val categoryId: String? = null,
    val priceCents: Long? = null,
    val sortOrder: Int = 0,
)

@Serializable
data class ItemResponse(
    val id: String,
    val venueId: String,
    val categoryId: String?,
    val name: String,
    val description: String?,
    val priceCents: Long?,
    val sortOrder: Int,
    val version: Int,
    val createdAt: String,
    val updatedAt: String,
)

@Serializable
data class ErrorResponse(val error: String, val message: String)

@Serializable
data class ConflictResponse(val error: String, val message: String, val current: ItemResponse?)

@Serializable
data class MenuEvent(
    val eventId: String,
    val eventType: String,
    val venueId: String,
    val itemId: String,
    val version: Int,
    val correlationId: String,
    val occurredAt: String,
    // Additive, optional (see docs/adr/0006-schema-evolution-menu-events.md): availability-service's
    // own copy of this class is deliberately left without this field to play the role of "the old
    // consumer" in that ADR's demo. Every consumer already sets ignoreUnknownKeys = true, so this
    // is backward compatible without any consumer change.
    val itemName: String? = null,
)
