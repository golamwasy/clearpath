package com.clearpath.availability.idempotency

import com.clearpath.availability.db.ProcessedEvents
import com.clearpath.tracing.TraceContext
import com.clearpath.tracing.Tracer
import org.jetbrains.exposed.exceptions.ExposedSQLException
import org.jetbrains.exposed.sql.Database
import org.jetbrains.exposed.sql.insert
import org.jetbrains.exposed.sql.transactions.transaction
import java.time.Instant
import java.util.UUID

class IdempotencyStore(private val db: Database, private val tracer: Tracer) {

    /**
     * Returns true if this is the first time we've seen eventId (and the record is now persisted),
     * false if it was already processed. The insert's primary-key conflict is the dedupe mechanism,
     * so this check-and-record is atomic even under concurrent consumers.
     */
    suspend fun markProcessedIfNew(eventId: UUID, eventType: String, ctx: TraceContext): Boolean =
        tracer.withSpan(ctx, "db.commit processed_events") {
            try {
                transaction(db) {
                    ProcessedEvents.insert {
                        it[ProcessedEvents.eventId] = eventId
                        it[ProcessedEvents.eventType] = eventType
                        it[processedAt] = Instant.now()
                    }
                }
                true
            } catch (e: ExposedSQLException) {
                false
            }
        }
}
