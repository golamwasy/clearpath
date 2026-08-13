package com.clearpath.storefront.service

import com.clearpath.storefront.cache.MenuCacheStore
import com.clearpath.storefront.client.AvailabilityServiceClient
import com.clearpath.storefront.client.MenuServiceClient
import com.clearpath.storefront.model.StorefrontMenuItem
import com.clearpath.storefront.model.StorefrontMenuResponse
import com.clearpath.tracing.TraceContext
import com.clearpath.tracing.Tracer
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Deferred

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
    // Single-flight per venueId: every request that misses the cache while a fetch for the same
    // venue is already in flight awaits that fetch's result instead of independently fanning out
    // to both upstreams — otherwise every concurrent request in the window right after TTL expiry
    // does its own upstream round trip (classic cache stampede).
    private val inFlight = ConcurrentHashMap<String, Deferred<StorefrontMenuResponse>>()

    suspend fun getMenu(venueId: String, ctx: TraceContext): StorefrontMenuResponse {
        cache.get(venueId)?.let { return it }

        val deferred = CompletableDeferred<StorefrontMenuResponse>()
        val existing = inFlight.putIfAbsent(venueId, deferred)
        if (existing != null) {
            return existing.await()
        }

        return try {
            cache.get(venueId)?.let {
                deferred.complete(it)
                return it
            }
            val response = fetchAndCompose(venueId, ctx)
            cache.put(response)
            deferred.complete(response)
            response
        } catch (e: Exception) {
            deferred.completeExceptionally(e)
            throw e
        } finally {
            inFlight.remove(venueId, deferred)
        }
    }

    private suspend fun fetchAndCompose(venueId: String, ctx: TraceContext): StorefrontMenuResponse =
        tracer.withSpan(ctx, "compose venue menu") { childCtx ->
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
}
