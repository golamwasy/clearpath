package com.clearpath.tracing

import kotlinx.serialization.Serializable

/** Wire format published to the `system.trace` topic. See docs/adr/0003-tracing-wire-format.md. */
@Serializable
data class Span(
    val correlationId: String,
    val spanId: String,
    val parentSpanId: String? = null,
    val service: String,
    val operation: String,
    val startedAt: String,
    val finishedAt: String,
    val durationMs: Long,
    val status: String,
    val error: String? = null,
    val root: Boolean,
)
