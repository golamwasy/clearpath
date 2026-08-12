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
)

@Serializable
data class UpdateItemRequest(
    val version: Int,
    val name: String,
    val description: String? = null,
    val categoryId: String? = null,
)

@Serializable
data class ItemResponse(
    val id: String,
    val venueId: String,
    val categoryId: String?,
    val name: String,
    val description: String?,
    val version: Int,
    val createdAt: String,
    val updatedAt: String,
)

@Serializable
data class ErrorResponse(val error: String, val message: String)

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
