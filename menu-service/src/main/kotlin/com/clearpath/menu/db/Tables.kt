package com.clearpath.menu.db

import org.jetbrains.exposed.sql.Table
import org.jetbrains.exposed.sql.javatime.timestamp

object Venues : Table("venues") {
    val id = uuid("id")
    val name = text("name")
    val createdAt = timestamp("created_at")
    override val primaryKey = PrimaryKey(id)
}

object Categories : Table("categories") {
    val id = uuid("id")
    val venueId = uuid("venue_id").references(Venues.id)
    val name = text("name")
    val sortOrder = integer("sort_order")
    val createdAt = timestamp("created_at")
    override val primaryKey = PrimaryKey(id)
}

object Items : Table("items") {
    val id = uuid("id")
    val venueId = uuid("venue_id").references(Venues.id)
    val categoryId = uuid("category_id").references(Categories.id).nullable()
    val name = text("name")
    val description = text("description").nullable()
    val priceCents = long("price_cents").nullable()
    val sortOrder = integer("sort_order")
    val version = integer("version")
    val deletedAt = timestamp("deleted_at").nullable()
    val createdAt = timestamp("created_at")
    val updatedAt = timestamp("updated_at")
    override val primaryKey = PrimaryKey(id)
}

object Modifiers : Table("modifiers") {
    val id = uuid("id")
    val itemId = uuid("item_id").references(Items.id)
    val name = text("name")
    val priceDeltaCents = long("price_delta_cents")
    override val primaryKey = PrimaryKey(id)
}

object Prices : Table("prices") {
    val id = uuid("id")
    val itemId = uuid("item_id").references(Items.id)
    val currency = char("currency", 3)
    val amountCents = long("amount_cents")
    val effectiveFrom = timestamp("effective_from")
    override val primaryKey = PrimaryKey(id)
}

object Outbox : Table("outbox") {
    val id = long("id").autoIncrement()
    val aggregateType = text("aggregate_type")
    val aggregateId = uuid("aggregate_id")
    val eventType = text("event_type")
    val payload = text("payload")
    val correlationId = text("correlation_id")
    val createdAt = timestamp("created_at")
    val publishedAt = timestamp("published_at").nullable()
    override val primaryKey = PrimaryKey(id)
}
