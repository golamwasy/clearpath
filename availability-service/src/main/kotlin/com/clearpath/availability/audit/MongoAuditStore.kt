package com.clearpath.availability.audit

import com.clearpath.availability.model.MenuEvent
import com.mongodb.kotlin.client.coroutine.MongoDatabase
import kotlinx.coroutines.runBlocking
import org.bson.Document
import java.time.Instant

class MongoAuditStore(private val database: MongoDatabase) {

    private val collection = database.getCollection<Document>("availability_audit")

    fun append(event: MenuEvent, available: Boolean) = runBlocking {
        val doc = Document()
            .append("eventId", event.eventId)
            .append("eventType", event.eventType)
            .append("venueId", event.venueId)
            .append("itemId", event.itemId)
            .append("version", event.version)
            .append("available", available)
            .append("correlationId", event.correlationId)
            .append("occurredAt", event.occurredAt)
            .append("recordedAt", Instant.now().toString())

        collection.insertOne(doc)
    }
}
