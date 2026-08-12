package com.clearpath.availability.audit

import com.clearpath.availability.model.MenuEvent
import com.mongodb.kotlin.client.coroutine.MongoDatabase
import kotlinx.coroutines.runBlocking
import org.bson.Document
import java.time.Instant

class MongoAuditStore(private val database: MongoDatabase) {

    private val collection = database.getCollection<Document>("availability_audit")

    fun append(event: MenuEvent, status: String) = runBlocking {
        val doc = Document()
            .append("eventId", event.eventId)
            .append("eventType", event.eventType)
            .append("venueId", event.venueId)
            .append("itemId", event.itemId)
            .append("version", event.version)
            .append("status", status)
            .append("correlationId", event.correlationId)
            .append("occurredAt", event.occurredAt)
            .append("recordedAt", Instant.now().toString())

        collection.insertOne(doc)
    }

    /** Manual merchant overrides don't originate from a MenuEvent, so this records the same audit shape without one — see ADR 0004. */
    fun appendManualOverride(venueId: String, itemId: String, status: String, soldOutUntil: String?, correlationId: String) = runBlocking {
        val doc = Document()
            .append("eventId", null)
            .append("eventType", "ManualAvailabilityOverride")
            .append("venueId", venueId)
            .append("itemId", itemId)
            .append("status", status)
            .append("soldOutUntil", soldOutUntil)
            .append("correlationId", correlationId)
            .append("occurredAt", Instant.now().toString())
            .append("recordedAt", Instant.now().toString())

        collection.insertOne(doc)
    }
}
