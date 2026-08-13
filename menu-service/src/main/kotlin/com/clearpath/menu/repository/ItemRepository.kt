package com.clearpath.menu.repository

import com.clearpath.menu.db.Items
import com.clearpath.menu.db.Outbox
import com.clearpath.menu.db.Venues
import com.clearpath.menu.model.CreateItemRequest
import com.clearpath.menu.model.ItemResponse
import com.clearpath.menu.model.MenuEvent
import com.clearpath.menu.model.UpdateItemRequest
import com.clearpath.menu.model.VenueSummary
import com.clearpath.tracing.TraceContext
import com.clearpath.tracing.Tracer
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.jetbrains.exposed.sql.Database
import org.jetbrains.exposed.sql.SortOrder
import org.jetbrains.exposed.sql.SqlExpressionBuilder.eq
import org.jetbrains.exposed.sql.and
import org.jetbrains.exposed.sql.insert
import org.jetbrains.exposed.sql.selectAll
import org.jetbrains.exposed.sql.transactions.transaction
import org.jetbrains.exposed.sql.update
import java.time.Instant
import java.util.UUID

sealed class ItemWriteResult {
    data class Success(val item: ItemResponse) : ItemWriteResult()
    object NotFound : ItemWriteResult()
    data class VersionConflict(val current: ItemResponse?) : ItemWriteResult()
}

/**
 * Narrower than [ItemWriteResult]: creating an item has no prior version to conflict with, so
 * [create] can't produce [ItemWriteResult.VersionConflict] — this return type says so at compile
 * time instead of leaving the route handler with an unreachable branch to interpret.
 */
sealed class ItemCreateResult {
    data class Success(val item: ItemResponse) : ItemCreateResult()
    object NotFound : ItemCreateResult()
}

class ItemRepository(private val db: Database, private val tracer: Tracer) {

    private val json = Json { ignoreUnknownKeys = true }

    suspend fun create(venueId: UUID, request: CreateItemRequest, ctx: TraceContext): ItemCreateResult =
        tracer.withSpan(ctx, "db.commit items") {
            transaction(db) {
                val venueExists = Venues.selectAll().where { Venues.id eq venueId }.limit(1).any()
                if (!venueExists) return@transaction ItemCreateResult.NotFound

                val itemId = UUID.randomUUID()
                val now = Instant.now()
                val categoryUuid = request.categoryId?.let { UUID.fromString(it) }

                Items.insert {
                    it[id] = itemId
                    it[Items.venueId] = venueId
                    it[categoryId] = categoryUuid
                    it[name] = request.name
                    it[description] = request.description
                    it[priceCents] = request.priceCents
                    it[sortOrder] = request.sortOrder
                    it[version] = 0
                    it[createdAt] = now
                    it[updatedAt] = now
                }

                writeOutboxEvent(
                    aggregateId = itemId,
                    venueId = venueId,
                    eventType = "ItemCreated",
                    version = 0,
                    correlationId = ctx.correlationId,
                    itemName = request.name,
                )

                ItemCreateResult.Success(
                    ItemResponse(
                        id = itemId.toString(),
                        venueId = venueId.toString(),
                        categoryId = categoryUuid?.toString(),
                        name = request.name,
                        description = request.description,
                        priceCents = request.priceCents,
                        sortOrder = request.sortOrder,
                        version = 0,
                        createdAt = now.toString(),
                        updatedAt = now.toString(),
                    )
                )
            }
        }

    suspend fun update(venueId: UUID, itemId: UUID, request: UpdateItemRequest, ctx: TraceContext): ItemWriteResult =
        tracer.withSpan(ctx, "db.commit items") {
            transaction(db) {
                val existing = Items.selectAll()
                    .where { (Items.id eq itemId) and (Items.venueId eq venueId) and Items.deletedAt.isNull() }
                    .limit(1)
                    .firstOrNull() ?: return@transaction ItemWriteResult.NotFound

                val currentVersion = existing[Items.version]
                val newVersion = currentVersion + 1
                val now = Instant.now()
                val categoryUuid = request.categoryId?.let { UUID.fromString(it) }

                val updatedRows = Items.update({
                    (Items.id eq itemId) and (Items.venueId eq venueId) and (Items.version eq request.version)
                }) {
                    it[name] = request.name
                    it[description] = request.description
                    it[categoryId] = categoryUuid
                    it[priceCents] = request.priceCents
                    it[sortOrder] = request.sortOrder
                    it[version] = newVersion
                    it[updatedAt] = now
                }

                if (updatedRows == 0) return@transaction ItemWriteResult.VersionConflict(currentItemResponse(itemId, venueId))

                writeOutboxEvent(
                    aggregateId = itemId,
                    venueId = venueId,
                    eventType = "ItemUpdated",
                    version = newVersion,
                    correlationId = ctx.correlationId,
                    itemName = request.name,
                )

                ItemWriteResult.Success(
                    ItemResponse(
                        id = itemId.toString(),
                        venueId = venueId.toString(),
                        categoryId = categoryUuid?.toString(),
                        name = request.name,
                        description = request.description,
                        priceCents = request.priceCents,
                        sortOrder = request.sortOrder,
                        version = newVersion,
                        createdAt = existing[Items.createdAt].toString(),
                        updatedAt = now.toString(),
                    )
                )
            }
        }

    suspend fun delete(venueId: UUID, itemId: UUID, expectedVersion: Int, ctx: TraceContext): ItemWriteResult =
        tracer.withSpan(ctx, "db.commit items") {
            transaction(db) {
                val existing = Items.selectAll()
                    .where { (Items.id eq itemId) and (Items.venueId eq venueId) and Items.deletedAt.isNull() }
                    .limit(1)
                    .firstOrNull() ?: return@transaction ItemWriteResult.NotFound

                val newVersion = existing[Items.version] + 1
                val now = Instant.now()

                val updatedRows = Items.update({
                    (Items.id eq itemId) and (Items.venueId eq venueId) and (Items.version eq expectedVersion)
                }) {
                    it[deletedAt] = now
                    it[version] = newVersion
                    it[updatedAt] = now
                }

                if (updatedRows == 0) return@transaction ItemWriteResult.VersionConflict(currentItemResponse(itemId, venueId))

                writeOutboxEvent(
                    aggregateId = itemId,
                    venueId = venueId,
                    eventType = "ItemDeleted",
                    version = newVersion,
                    correlationId = ctx.correlationId,
                    itemName = existing[Items.name],
                )

                ItemWriteResult.Success(
                    ItemResponse(
                        id = itemId.toString(),
                        venueId = venueId.toString(),
                        categoryId = existing[Items.categoryId]?.toString(),
                        name = existing[Items.name],
                        description = existing[Items.description],
                        priceCents = existing[Items.priceCents],
                        sortOrder = existing[Items.sortOrder],
                        version = newVersion,
                        createdAt = existing[Items.createdAt].toString(),
                        updatedAt = now.toString(),
                    )
                )
            }
        }

    fun list(venueId: UUID): List<ItemResponse> = transaction(db) {
        Items.selectAll()
            .where { (Items.venueId eq venueId) and Items.deletedAt.isNull() }
            .map {
                ItemResponse(
                    id = it[Items.id].toString(),
                    venueId = it[Items.venueId].toString(),
                    categoryId = it[Items.categoryId]?.toString(),
                    name = it[Items.name],
                    description = it[Items.description],
                    priceCents = it[Items.priceCents],
                    sortOrder = it[Items.sortOrder],
                    version = it[Items.version],
                    createdAt = it[Items.createdAt].toString(),
                    updatedAt = it[Items.updatedAt].toString(),
                )
            }
    }

    /** Re-selects an item's current row, for attaching to a 409 conflict response. Called inside the same transaction as the failed conditional write, so it reflects the actual winning writer, not a stale read. */
    private fun currentItemResponse(itemId: UUID, venueId: UUID): ItemResponse? =
        Items.selectAll()
            .where { (Items.id eq itemId) and (Items.venueId eq venueId) }
            .limit(1)
            .firstOrNull()
            ?.let {
                ItemResponse(
                    id = it[Items.id].toString(),
                    venueId = it[Items.venueId].toString(),
                    categoryId = it[Items.categoryId]?.toString(),
                    name = it[Items.name],
                    description = it[Items.description],
                    priceCents = it[Items.priceCents],
                    sortOrder = it[Items.sortOrder],
                    version = it[Items.version],
                    createdAt = it[Items.createdAt].toString(),
                    updatedAt = it[Items.updatedAt].toString(),
                )
            }

    /** Rows the relay hasn't published yet — the outbox backlog depth metric. See docs on /metrics. */
    fun outboxBacklogCount(): Long = transaction(db) {
        Outbox.selectAll().where { Outbox.publishedAt.isNull() }.count()
    }

    /**
     * Every venue, newest first. No pagination: venues are created by hand in this system (there's
     * no bulk import path), so the row count is bounded by operator effort, not by traffic. If that
     * ever changes this needs a limit/cursor before it's a read-path hazard.
     */
    fun listVenues(): List<VenueSummary> = transaction(db) {
        Venues.selectAll()
            .orderBy(Venues.createdAt to SortOrder.DESC)
            .map {
                VenueSummary(
                    id = it[Venues.id].toString(),
                    name = it[Venues.name],
                    createdAt = it[Venues.createdAt].toString(),
                )
            }
    }

    fun createVenue(name: String): String = transaction(db) {
        val id = UUID.randomUUID()
        Venues.insert {
            it[Venues.id] = id
            it[Venues.name] = name
            it[createdAt] = Instant.now()
        }
        id.toString()
    }

    /** Must be called inside an existing transaction so the outbox write is atomic with the domain write. */
    private fun writeOutboxEvent(
        aggregateId: UUID,
        venueId: UUID,
        eventType: String,
        version: Int,
        correlationId: String,
        itemName: String? = null,
    ) {
        val event = MenuEvent(
            eventId = UUID.randomUUID().toString(),
            eventType = eventType,
            venueId = venueId.toString(),
            itemId = aggregateId.toString(),
            version = version,
            correlationId = correlationId,
            occurredAt = Instant.now().toString(),
            itemName = itemName,
        )
        Outbox.insert {
            it[aggregateType] = "Item"
            it[Outbox.aggregateId] = aggregateId
            it[Outbox.eventType] = eventType
            it[payload] = json.encodeToString(event)
            it[Outbox.correlationId] = correlationId
            it[createdAt] = Instant.now()
            it[publishedAt] = null
        }
    }
}
