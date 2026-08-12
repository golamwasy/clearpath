package com.clearpath.menu

import io.ktor.server.application.ApplicationCall
import io.ktor.server.application.createApplicationPlugin
import io.ktor.server.request.header
import io.ktor.server.response.header
import org.slf4j.MDC
import java.util.UUID

const val CORRELATION_ID_HEADER = "X-Correlation-Id"

val CorrelationIdPlugin = createApplicationPlugin("CorrelationIdPlugin") {
    onCall { call ->
        val correlationId = call.request.header(CORRELATION_ID_HEADER) ?: UUID.randomUUID().toString()
        call.correlationId = correlationId
        MDC.put("correlationId", correlationId)
        call.response.header(CORRELATION_ID_HEADER, correlationId)
    }
}

private val correlationIdKey = io.ktor.util.AttributeKey<String>("correlationId")

var ApplicationCall.correlationId: String
    get() = attributes[correlationIdKey]
    set(value) = attributes.put(correlationIdKey, value)
