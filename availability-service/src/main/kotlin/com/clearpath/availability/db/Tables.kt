package com.clearpath.availability.db

import org.jetbrains.exposed.sql.Table
import org.jetbrains.exposed.sql.javatime.timestamp

object ProcessedEvents : Table("processed_events") {
    val eventId = uuid("event_id")
    val eventType = text("event_type")
    val processedAt = timestamp("processed_at")
    override val primaryKey = PrimaryKey(eventId)
}
