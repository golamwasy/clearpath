package com.clearpath.menu.outbox

import com.clearpath.menu.AppConfig
import com.clearpath.menu.db.Outbox
import com.clearpath.tracing.SpanAttributes
import com.clearpath.tracing.TraceContext
import com.clearpath.tracing.Tracer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.apache.kafka.clients.producer.KafkaProducer
import org.apache.kafka.clients.producer.ProducerConfig
import org.apache.kafka.clients.producer.ProducerRecord
import org.apache.kafka.common.header.internals.RecordHeader
import org.apache.kafka.common.serialization.StringSerializer
import org.jetbrains.exposed.sql.Database
import org.jetbrains.exposed.sql.SqlExpressionBuilder.eq
import org.jetbrains.exposed.sql.SqlExpressionBuilder.less
import org.jetbrains.exposed.sql.and
import org.jetbrains.exposed.sql.or
import org.jetbrains.exposed.sql.selectAll
import org.jetbrains.exposed.sql.transactions.transaction
import org.jetbrains.exposed.sql.update
import org.jetbrains.exposed.sql.vendors.ForUpdateOption
import org.slf4j.LoggerFactory
import java.time.Duration
import java.time.Instant
import java.util.Properties

private data class OutboxRow(
    val id: Long,
    val aggregateId: java.util.UUID,
    val payload: String,
    val correlationId: String,
)

class OutboxRelay(private val config: AppConfig, private val db: Database, private val tracer: Tracer) {

    private val logger = LoggerFactory.getLogger(OutboxRelay::class.java)

    private val producer: KafkaProducer<String, String> by lazy {
        val props = Properties().apply {
            put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, config.kafkaBootstrapServers)
            put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer::class.java.name)
            put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, StringSerializer::class.java.name)
            put(ProducerConfig.ACKS_CONFIG, "all")
            put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, "true")
        }
        KafkaProducer(props)
    }

    fun start(scope: CoroutineScope) {
        scope.launch(Dispatchers.IO) {
            while (isActive) {
                try {
                    val published = pollAndPublishOnce()
                    if (published == 0) delay(config.outboxPollIntervalMs)
                } catch (e: Exception) {
                    logger.error("outbox relay poll failed", e)
                    delay(config.outboxPollIntervalMs)
                }
            }
        }
    }

    /**
     * Publishes up to one batch's worth of unpublished rows. Each row is claimed (see
     * [claimNextRow]) in its own short transaction before being published, so no Postgres row
     * lock or JDBC connection is held across the Kafka network round-trip — only across the local
     * claim/release UPDATE, same as [markPublished].
     */
    suspend fun pollAndPublishOnce(): Int {
        var publishedCount = 0
        while (publishedCount < config.outboxBatchSize) {
            val row = claimNextRow() ?: break
            publishRow(row)
            publishedCount++
        }
        return publishedCount
    }

    /**
     * Claims the oldest unpublished, unclaimed (or stale-claimed) row with `FOR UPDATE SKIP
     * LOCKED` and an immediate `claimedAt` stamp, all in one short transaction — so a second relay
     * instance running the same query concurrently skips whatever this instance just claimed
     * instead of double-claiming it, but the lock itself is released the moment this transaction
     * commits, well before the Kafka publish that follows. If a relay instance crashes between
     * claiming and publishing, [CLAIM_LEASE] bounds how long the row stays stuck: any instance's
     * next poll can reclaim it once the lease expires.
     */
    private suspend fun claimNextRow(): OutboxRow? = transaction(db) {
        val staleBefore = Instant.now().minus(CLAIM_LEASE)
        val row = Outbox.selectAll()
            .where {
                Outbox.publishedAt.isNull() and
                    (Outbox.claimedAt.isNull() or (Outbox.claimedAt less staleBefore))
            }
            .orderBy(Outbox.id)
            .limit(1)
            .forUpdate(ForUpdateOption.PostgreSQL.ForUpdate(ForUpdateOption.PostgreSQL.MODE.SKIP_LOCKED))
            .map {
                OutboxRow(
                    id = it[Outbox.id],
                    aggregateId = it[Outbox.aggregateId],
                    payload = it[Outbox.payload],
                    correlationId = it[Outbox.correlationId],
                )
            }
            .firstOrNull() ?: return@transaction null

        Outbox.update({ Outbox.id eq row.id }) {
            it[claimedAt] = Instant.now()
        }
        row
    }

    private suspend fun publishRow(row: OutboxRow) {
        // The outbox table only persists correlationId, not the request's spanId, so the relay
        // hop's parent is unrecoverable — its span is emitted with root=true even though it isn't
        // the trace's true origin.
        val attrs = SpanAttributes()
        tracer.withSpan(TraceContext.root(row.correlationId), "kafka.publish ${config.menuEventsTopic}", attrs) {
            val record = ProducerRecord(config.menuEventsTopic, row.aggregateId.toString(), row.payload)
            record.headers().add(RecordHeader("correlationId", row.correlationId.toByteArray()))

            val ackedOffset = producer.send(record).get()
            attrs.kafkaPartition = ackedOffset.partition()
            logger.info("published outbox row id=${row.id} offset=${ackedOffset.offset()}")
        }
        markPublished(row.id)
    }

    private suspend fun markPublished(id: Long) {
        transaction(db) {
            Outbox.update({ Outbox.id eq id }) {
                it[publishedAt] = Instant.now()
            }
        }
    }

    fun close() {
        producer.close()
    }

    companion object {
        /** How long a claim is honored before another poll (any instance) may reclaim the row. */
        private val CLAIM_LEASE = Duration.ofSeconds(30)
    }
}
