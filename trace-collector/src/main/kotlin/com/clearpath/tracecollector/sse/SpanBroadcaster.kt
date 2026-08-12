package com.clearpath.tracecollector.sse

import com.clearpath.tracing.Span
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow

/**
 * In-memory fanout from the Kafka consumer to any number of connected SSE clients. A slow or
 * absent subscriber never blocks ingestion — the buffer drops the oldest span rather than
 * back-pressuring the consumer, since a live stream is best-effort by nature (a client that
 * missed a span can still fetch the full trace via `GET /traces/{correlationId}`).
 */
class SpanBroadcaster {
    private val _spans = MutableSharedFlow<Span>(
        replay = 0,
        extraBufferCapacity = 256,
        onBufferOverflow = kotlinx.coroutines.channels.BufferOverflow.DROP_OLDEST,
    )

    val spans: SharedFlow<Span> = _spans.asSharedFlow()

    suspend fun publish(span: Span) {
        _spans.emit(span)
    }
}
