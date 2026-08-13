package com.clearpath.storefront.model

import kotlinx.serialization.Serializable

@Serializable
data class MenuItemResponse(
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

/**
 * The composed read: a menu item joined with its current availability on [itemId]. [status]
 * defaults to "unknown" when availability-service has no state for this item yet (e.g. it
 * hasn't consumed the item's menu.events yet) — this is a real, distinct state from
 * "in_stock"/"sold_out", not an error, so it's surfaced rather than defaulted to either.
 */
@Serializable
data class StorefrontMenuItem(
    val id: String,
    val venueId: String,
    val categoryId: String?,
    val name: String,
    val description: String?,
    val priceCents: Long?,
    val sortOrder: Int,
    val status: String,
    val soldOutUntil: String? = null,
)

@Serializable
data class StorefrontMenuResponse(val venueId: String, val items: List<StorefrontMenuItem>)

@Serializable
data class ErrorResponse(val error: String, val message: String)
