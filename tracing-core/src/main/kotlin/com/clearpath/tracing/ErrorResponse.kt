package com.clearpath.tracing

import kotlinx.serialization.Serializable

/**
 * The error-body shape every service's StatusPages handler responds with. Shared here because
 * menu-service, availability-service, and storefront-api each independently declared an
 * identical `data class ErrorResponse(val error: String, val message: String)` — this has no
 * effect on the wire contract (each service's own openapi.yaml, and the frontend types generated
 * from it, are unchanged), it's purely removing three copies of the same internal type.
 */
@Serializable
data class ErrorResponse(val error: String, val message: String)
