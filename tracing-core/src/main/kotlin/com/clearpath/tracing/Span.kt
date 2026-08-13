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
    /** Dedupe key the consuming service checked against, when this span is a dedupe-checked Kafka consume. */
    val idempotencyKey: String? = null,
    val kafkaPartition: Int? = null,
    val retryCount: Int? = null,
)

/**
 * Mutable holder for the optional [Span] fields above, passed into [Tracer.withSpan] and read
 * back after the block completes — lets a caller populate a field (e.g. a Kafka partition) that
 * is only known partway through the span, without changing [Tracer.withSpan]'s block signature.
 */
class SpanAttributes(
    var idempotencyKey: String? = null,
    var kafkaPartition: Int? = null,
    var retryCount: Int? = null,
)
