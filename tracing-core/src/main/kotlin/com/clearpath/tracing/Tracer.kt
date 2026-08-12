package com.clearpath.tracing

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.apache.kafka.clients.producer.KafkaProducer
import org.apache.kafka.clients.producer.ProducerConfig
import org.apache.kafka.clients.producer.ProducerRecord
import org.apache.kafka.common.header.internals.RecordHeader
import org.apache.kafka.common.serialization.StringSerializer
import org.slf4j.LoggerFactory
import java.time.Duration
import java.time.Instant
import java.util.Properties

const val CORRELATION_ID_HEADER = "X-Correlation-Id"
const val CORRELATION_ID_KAFKA_HEADER = "correlationId"

/**
 * Emits spans to `system.trace`, fire and forget: publish failures are logged, never thrown,
 * and [withSpan] always runs [block] and returns/rethrows its outcome regardless of whether the
 * span was successfully published.
 */
class Tracer(private val service: String, kafkaBootstrapServers: String, private val topic: String) {

    private val logger = LoggerFactory.getLogger(Tracer::class.java)
    private val json = Json { ignoreUnknownKeys = true }

    private val producer: KafkaProducer<String, String> by lazy {
        val props = Properties().apply {
            put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, kafkaBootstrapServers)
            put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer::class.java.name)
            put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, StringSerializer::class.java.name)
            put(ProducerConfig.ACKS_CONFIG, "1")
        }
        KafkaProducer(props)
    }

    /**
     * Runs [block] under a new child span of [ctx], and emits that span afterward regardless of
     * whether [block] succeeded or threw — an exception is recorded as `status=error` and then
     * rethrown unchanged, so tracing observes failures without ever swallowing them.
     */
    suspend fun <T> withSpan(ctx: TraceContext, operation: String, block: suspend (TraceContext) -> T): T {
        val child = TraceContext(ctx.correlationId, TraceContext.newId())
        val start = Instant.now()
        return try {
            val result = block(child)
            emit(child, ctx.spanId, operation, start, Instant.now(), "ok", null)
            result
        } catch (e: Exception) {
            emit(child, ctx.spanId, operation, start, Instant.now(), "error", e.message)
            throw e
        }
    }

    private fun emit(
        ctx: TraceContext,
        parentSpanId: String,
        operation: String,
        start: Instant,
        end: Instant,
        status: String,
        error: String?,
    ) {
        try {
            val span = Span(
                correlationId = ctx.correlationId,
                spanId = ctx.spanId,
                parentSpanId = parentSpanId.ifBlank { null },
                service = service,
                operation = operation,
                startedAt = start.toString(),
                finishedAt = end.toString(),
                durationMs = Duration.between(start, end).toMillis(),
                status = status,
                error = error,
                root = parentSpanId.isBlank(),
            )
            val record = ProducerRecord(topic, span.correlationId, json.encodeToString(span))
            record.headers().add(RecordHeader(CORRELATION_ID_KAFKA_HEADER, span.correlationId.toByteArray()))
            producer.send(record) { _, exception ->
                if (exception != null) logger.warn("failed to publish span for operation={}", operation, exception)
            }
        } catch (e: Exception) {
            logger.warn("failed to build/emit span for operation={}", operation, e)
        }
    }

    fun close() = producer.close()
}
