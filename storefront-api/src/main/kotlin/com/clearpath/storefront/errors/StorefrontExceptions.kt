package com.clearpath.storefront.errors

/**
 * Thrown by the upstream clients so the StatusPages handler can say which upstream failed
 * (menu-service, availability-service, or the cache) instead of a single generic "upstream_error"
 * for every failure mode — see ADR 0007, which already claims this distinction exists.
 *
 * [upstreamStatus] is set only when the upstream actually answered with a non-2xx (e.g. a
 * legitimate 404 for an unknown venue) — that's forwarded as-is rather than flattened into a 502,
 * since it isn't storefront-api or its upstream being broken. Null means storefront-api couldn't
 * reach or didn't hear back from the upstream at all (connection failure, timeout).
 */
class UpstreamServiceException(val service: String, val upstreamStatus: Int? = null, message: String, cause: Throwable? = null) :
    Exception(message, cause)

class CacheException(message: String, cause: Throwable? = null) : Exception(message, cause)
