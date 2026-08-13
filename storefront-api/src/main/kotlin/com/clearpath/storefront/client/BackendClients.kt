package com.clearpath.storefront.client

import com.clearpath.storefront.errors.UpstreamServiceException
import com.clearpath.storefront.model.AvailabilityResponse
import com.clearpath.storefront.model.MenuItemResponse
import com.clearpath.tracing.CORRELATION_ID_HEADER
import com.clearpath.tracing.TraceContext
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.plugins.HttpRequestTimeoutException
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.statement.HttpResponse
import io.ktor.http.isSuccess

/**
 * Thin composition clients for the two upstream services storefront-api reads from. Each call
 * propagates the ambient correlation ID as a plain HTTP header — the same header
 * `installTracing` reads on the way in — so a storefront-api request shows up as one trace
 * spanning all three services, per CLAUDE.md invariant 3.
 *
 * Every failure — non-2xx response, timeout, or connection error — is normalized into an
 * [UpstreamServiceException] naming which service failed, so the StatusPages handler can report
 * that instead of a single undifferentiated 502.
 */
class MenuServiceClient(private val http: HttpClient, private val baseUrl: String) {
    suspend fun listItems(venueId: String, ctx: TraceContext): List<MenuItemResponse> =
        request("menu-service") {
            http.get("$baseUrl/venues/$venueId/items") {
                header(CORRELATION_ID_HEADER, ctx.correlationId)
            }
        }.body()
}

class AvailabilityServiceClient(private val http: HttpClient, private val baseUrl: String) {
    suspend fun listAvailability(venueId: String, ctx: TraceContext): AvailabilityResponse =
        request("availability-service") {
            http.get("$baseUrl/venues/$venueId/availability") {
                header(CORRELATION_ID_HEADER, ctx.correlationId)
            }
        }.body()
}

private suspend fun request(service: String, block: suspend () -> HttpResponse): HttpResponse {
    val response = try {
        block()
    } catch (e: HttpRequestTimeoutException) {
        throw UpstreamServiceException(service, message = "$service timed out", cause = e)
    } catch (e: Exception) {
        throw UpstreamServiceException(service, message = "$service unreachable: ${e.message}", cause = e)
    }
    if (!response.status.isSuccess()) {
        throw UpstreamServiceException(
            service,
            upstreamStatus = response.status.value,
            message = "$service returned ${response.status.value}",
        )
    }
    return response
}
