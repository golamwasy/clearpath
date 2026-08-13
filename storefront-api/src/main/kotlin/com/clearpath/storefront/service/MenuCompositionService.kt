package com.clearpath.storefront.service

import com.clearpath.storefront.cache.MenuCacheStore
import com.clearpath.storefront.client.AvailabilityServiceClient
import com.clearpath.storefront.client.MenuServiceClient
import com.clearpath.storefront.model.StorefrontMenuItem
import com.clearpath.storefront.model.StorefrontMenuResponse
import com.clearpath.tracing.TraceContext
import com.clearpath.tracing.Tracer

/**
 * The one composed read this service exists for: menu-service's items joined with
 * availability-service's current status on itemId, cache-aside through Redis. Two upstream
 * services are called sequentially, not concurrently — this endpoint's load profile at this
 * phase doesn't need the added complexity, and it keeps the trace waterfall easy to read; worth
 * revisiting if k6 shows composition latency dominating.
 */
class MenuCompositionService(
    private val menuClient: MenuServiceClient,
    private val availabilityClient: AvailabilityServiceClient,
    private val cache: MenuCacheStore,
    private val tracer: Tracer,
) {
    suspend fun getMenu(venueId: String, ctx: TraceContext): StorefrontMenuResponse {
        cache.get(venueId)?.let { return it }

        val response = tracer.withSpan(ctx, "compose venue menu") { childCtx ->
            val items = menuClient.listItems(venueId, childCtx)
            val availability = availabilityClient.listAvailability(venueId, childCtx)
                .items.associateBy { it.itemId }

            StorefrontMenuResponse(
                venueId = venueId,
                items = items.map { item ->
                    val state = availability[item.id]
                    StorefrontMenuItem(
                        id = item.id,
                        venueId = item.venueId,
                        categoryId = item.categoryId,
                        name = item.name,
                        description = item.description,
                        priceCents = item.priceCents,
                        sortOrder = item.sortOrder,
                        status = state?.status ?: "unknown",
                        soldOutUntil = state?.soldOutUntil,
                    )
                },
            )
        }

        cache.put(response)
        return response
    }
}
