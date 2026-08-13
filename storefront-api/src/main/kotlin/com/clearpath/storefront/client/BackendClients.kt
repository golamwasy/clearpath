package com.clearpath.storefront.client

import com.clearpath.storefront.model.AvailabilityResponse
import com.clearpath.storefront.model.MenuItemResponse
import com.clearpath.tracing.CORRELATION_ID_HEADER
import com.clearpath.tracing.TraceContext
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.get
import io.ktor.client.request.header

/**
 * Thin composition clients for the two upstream services storefront-api reads from. Each call
 * propagates the ambient correlation ID as a plain HTTP header — the same header
 * `installTracing` reads on the way in — so a storefront-api request shows up as one trace
 * spanning all three services, per CLAUDE.md invariant 3.
 */
class MenuServiceClient(private val http: HttpClient, private val baseUrl: String) {
    suspend fun listItems(venueId: String, ctx: TraceContext): List<MenuItemResponse> =
        http.get("$baseUrl/venues/$venueId/items") {
            header(CORRELATION_ID_HEADER, ctx.correlationId)
        }.body()
}

class AvailabilityServiceClient(private val http: HttpClient, private val baseUrl: String) {
    suspend fun listAvailability(venueId: String, ctx: TraceContext): AvailabilityResponse =
        http.get("$baseUrl/venues/$venueId/availability") {
            header(CORRELATION_ID_HEADER, ctx.correlationId)
        }.body()
}
