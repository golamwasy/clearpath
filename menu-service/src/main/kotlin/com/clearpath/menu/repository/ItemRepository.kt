package com.clearpath.menu.repository

import com.clearpath.menu.db.Items
import com.clearpath.menu.db.Outbox
import com.clearpath.menu.db.Venues
import com.clearpath.menu.model.CreateItemRequest
import com.clearpath.menu.model.ItemResponse
import com.clearpath.menu.model.MenuEvent
import com.clearpath.menu.model.UpdateItemRequest
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.jetbrains.exposed.sql.Database
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
    object VersionConflict : ItemWriteResult()
}

class ItemRepository(private val db: Database) {

    private val json = Json { ignoreUnknownKeys = true }

    fun create(venueId: UUID, request: CreateItemRequest, correlationId: String): ItemWriteResult = transaction(db) {
        val venueExists = Venues.selectAll().where { Venues.id eq venueId }.limit(1).any()
        if (!venueExists) return@transaction ItemWriteResult.NotFound

        val itemId = UUID.randomUUID()
        val now = Instant.now()
        val categoryUuid = request.categoryId?.let { UUID.fromString(it) }

        Items.insert {
            it[id] = itemId
            it[Items.venueId] = venueId
            it[categoryId] = categoryUuid
            it[name] = request.name
            it[description] = request.description
            it[version] = 0
            it[createdAt] = now
            it[updatedAt] = now
        }

        writeOutboxEvent(
            aggregateId = itemId,
            venueId = venueId,
            eventType = "ItemCreated",
            version = 0,
            correlationId = correlationId,
        )

        ItemWriteResult.Success(
            ItemResponse(
                id = itemId.toString(),
                venueId = venueId.toString(),
                categoryId = categoryUuid?.toString(),
                name = request.name,
                description = request.description,
                version = 0,
                createdAt = now.toString(),
                updatedAt = now.toString(),
            )
        )
    }

    fun update(venueId: UUID, itemId: UUID, request: UpdateItemRequest, correlationId: String): ItemWriteResult =
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
                it[version] = newVersion
                it[updatedAt] = now
            }

            if (updatedRows == 0) return@transaction ItemWriteResult.VersionConflict

            writeOutboxEvent(
                aggregateId = itemId,
                venueId = venueId,
                eventType = "ItemUpdated",
                version = newVersion,
                correlationId = correlationId,
            )

            ItemWriteResult.Success(
                ItemResponse(
                    id = itemId.toString(),
                    venueId = venueId.toString(),
                    categoryId = categoryUuid?.toString(),
                    name = request.name,
                    description = request.description,
                    version = newVersion,
                    createdAt = existing[Items.createdAt].toString(),
                    updatedAt = now.toString(),
                )
            )
        }

    fun delete(venueId: UUID, itemId: UUID, expectedVersion: Int, correlationId: String): ItemWriteResult =
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

            if (updatedRows == 0) return@transaction ItemWriteResult.VersionConflict

            writeOutboxEvent(
                aggregateId = itemId,
                venueId = venueId,
                eventType = "ItemDeleted",
                version = newVersion,
                correlationId = correlationId,
            )

            ItemWriteResult.Success(
                ItemResponse(
                    id = itemId.toString(),
                    venueId = venueId.toString(),
                    categoryId = existing[Items.categoryId]?.toString(),
                    name = existing[Items.name],
                    description = existing[Items.description],
                    version = newVersion,
                    createdAt = existing[Items.createdAt].toString(),
                    updatedAt = now.toString(),
                )
            )
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
                    version = it[Items.version],
                    createdAt = it[Items.createdAt].toString(),
                    updatedAt = it[Items.updatedAt].toString(),
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
    ) {
        val event = MenuEvent(
            eventId = UUID.randomUUID().toString(),
            eventType = eventType,
            venueId = venueId.toString(),
            itemId = aggregateId.toString(),
            version = version,
            correlationId = correlationId,
            occurredAt = Instant.now().toString(),
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
