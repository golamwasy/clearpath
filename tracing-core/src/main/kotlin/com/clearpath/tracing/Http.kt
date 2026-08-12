package com.clearpath.tracing

import io.ktor.server.application.Application
import io.ktor.server.application.ApplicationCall
import io.ktor.server.application.ApplicationCallPipeline
import io.ktor.server.application.call
import io.ktor.server.request.header
import io.ktor.server.request.httpMethod
import io.ktor.server.request.path
import io.ktor.server.response.header
import io.ktor.util.AttributeKey
import org.slf4j.MDC

private val traceContextKey = AttributeKey<TraceContext>("traceContext")

/** Set once per request by [installTracing]; the ambient context for that request's handling. */
var ApplicationCall.traceContext: TraceContext
    get() = attributes[traceContextKey]
    internal set(value) = attributes.put(traceContextKey, value)

/**
 * Installs an HTTP-entry span covering the full request (extracting an inbound correlation ID
 * or generating one and marking the span root), and echoes the correlation ID back on the
 * response header. Must be installed early enough to wrap route dispatch — hooks the
 * [ApplicationCallPipeline.Monitoring] phase directly rather than a plugin's `onCall`, which
 * fires before routing rather than around it.
 */
fun Application.installTracing(tracer: Tracer) {
    intercept(ApplicationCallPipeline.Monitoring) {
        val incoming = call.request.header(CORRELATION_ID_HEADER)
        val correlationId = incoming ?: TraceContext.newId()
        call.response.header(CORRELATION_ID_HEADER, correlationId)
        MDC.put("correlationId", correlationId)

        val operation = "http.${call.request.httpMethod.value} ${call.request.path()}"
        tracer.withSpan(TraceContext.root(correlationId), operation) { ctx ->
            call.traceContext = ctx
            proceed()
        }
    }
}
