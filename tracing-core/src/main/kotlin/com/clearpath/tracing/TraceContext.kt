package com.clearpath.tracing

import java.util.UUID

/**
 * The ambient tracing state threaded explicitly through call sites (not carried on a
 * ThreadLocal/MDC) so it survives dispatcher hops between Ktor's Netty event loop and
 * blocking JDBC/Jedis calls without relying on thread-affinity guarantees.
 *
 * [spanId] is the nearest enclosing span, used as the parent when the next child span is
 * opened. An empty [spanId] means "no known parent" — either this is genuinely the trace's
 * origin, or the parent span id wasn't available to propagate (e.g. it wasn't persisted
 * alongside a stored correlation ID, as with menu-service's outbox rows).
 */
data class TraceContext(val correlationId: String, val spanId: String = "") {
    companion object {
        fun root(correlationId: String) = TraceContext(correlationId, spanId = "")

        fun newId(): String = UUID.randomUUID().toString()
    }
}
