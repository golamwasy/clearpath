package com.clearpath.availability.idempotency

import com.clearpath.availability.db.ProcessedEvents
import com.clearpath.tracing.TraceContext
import com.clearpath.tracing.Tracer
import org.jetbrains.exposed.exceptions.ExposedSQLException
import org.jetbrains.exposed.sql.Database
import org.jetbrains.exposed.sql.SqlExpressionBuilder.eq
import org.jetbrains.exposed.sql.deleteWhere
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
                // Only a genuine unique-constraint violation (Postgres SQLState 23505) means "this
                // event really was already processed." Any other SQL error here (connection drop,
                // deadlock, disk full, ...) is a transient failure, not a duplicate — treating it
                // as "already processed" would make handleEvent skip the event as a no-op offset
                // gets committed for it, without ever writing to Redis/Mongo. Rethrowing instead
                // lets the poll loop's failure handling (no commit, redelivery) take over.
                if (e.sqlState == UNIQUE_VIOLATION_SQLSTATE) {
                    false
                } else {
                    throw e
                }
            }
        }

    /**
     * Compensating action for when the Redis/Mongo work after [markProcessedIfNew] throws: undoes
     * the insert so the event is no longer "processed" and a future redelivery retries it, instead
     * of the event being permanently marked done with no state ever actually written.
     */
    suspend fun unmarkProcessed(eventId: UUID, ctx: TraceContext) {
        tracer.withSpan(ctx, "db.rollback processed_events") {
            transaction(db) {
                ProcessedEvents.deleteWhere { ProcessedEvents.eventId eq eventId }
            }
        }
    }

    companion object {
        private const val UNIQUE_VIOLATION_SQLSTATE = "23505"
    }
}
