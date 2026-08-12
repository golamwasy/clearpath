package com.clearpath.tracecollector.store

import com.clearpath.tracecollector.model.TraceSummary
import com.clearpath.tracing.Span
import com.mongodb.client.model.Filters
import com.mongodb.client.model.Sorts
import com.mongodb.kotlin.client.coroutine.MongoDatabase
import kotlinx.coroutines.flow.toList
import org.bson.Document
import java.time.Duration
import java.time.Instant

class SpanStore(database: MongoDatabase) {

    private val collection = database.getCollection<Document>("spans")

    // Spans are diagnostic, not a source of truth another service depends on — reprocessing
    // system.trace on restart re-inserting a duplicate span is harmless here (worst case a
    // duplicate row in a list), so this consumer intentionally skips the dedupe-table pattern
    // invariant #2 requires for correctness-sensitive consumers. See docs/adr/0003.
    suspend fun insert(span: Span) {
        val doc = Document()
            .append("correlationId", span.correlationId)
            .append("spanId", span.spanId)
            .append("parentSpanId", span.parentSpanId)
            .append("service", span.service)
            .append("operation", span.operation)
            .append("startedAt", span.startedAt)
            .append("finishedAt", span.finishedAt)
            .append("durationMs", span.durationMs)
            .append("status", span.status)
            .append("error", span.error)
            .append("root", span.root)
        collection.insertOne(doc)
    }

    suspend fun findByCorrelationId(correlationId: String): List<Span> =
        collection.find(Filters.eq("correlationId", correlationId))
            .sort(Sorts.ascending("startedAt"))
            .toList()
            .map { it.toSpan() }

    suspend fun recentTraces(limit: Int): List<TraceSummary> {
        val pipeline = listOf(
            Document(
                "\$group",
                Document()
                    .append("_id", "\$correlationId")
                    .append("startedAt", Document("\$min", "\$startedAt"))
                    .append("finishedAt", Document("\$max", "\$finishedAt"))
                    .append("spanCount", Document("\$sum", 1))
                    .append(
                        "errorCount",
                        Document(
                            "\$sum",
                            Document("\$cond", listOf(Document("\$eq", listOf("\$status", "error")), 1, 0)),
                        ),
                    ),
            ),
            Document("\$sort", Document("startedAt", -1)),
            Document("\$limit", limit),
        )
        return collection.aggregate<Document>(pipeline).toList().map { doc ->
            val startedAt = doc.getString("startedAt")
            val finishedAt = doc.getString("finishedAt")
            TraceSummary(
                correlationId = doc.getString("_id"),
                startedAt = startedAt,
                finishedAt = finishedAt,
                durationMs = Duration.between(Instant.parse(startedAt), Instant.parse(finishedAt)).toMillis(),
                spanCount = doc.getInteger("spanCount"),
                status = if (doc.getInteger("errorCount") > 0) "error" else "ok",
            )
        }
    }

    private fun Document.toSpan() = Span(
        correlationId = getString("correlationId"),
        spanId = getString("spanId"),
        parentSpanId = getString("parentSpanId"),
        service = getString("service"),
        operation = getString("operation"),
        startedAt = getString("startedAt"),
        finishedAt = getString("finishedAt"),
        durationMs = getLong("durationMs"),
        status = getString("status"),
        error = getString("error"),
        root = getBoolean("root"),
    )
}
