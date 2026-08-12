package com.clearpath.menu.outbox

import com.clearpath.menu.AppConfig
import com.clearpath.menu.db.Outbox
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
import org.jetbrains.exposed.sql.selectAll
import org.jetbrains.exposed.sql.transactions.transaction
import org.jetbrains.exposed.sql.update
import org.slf4j.LoggerFactory
import java.time.Instant
import java.util.Properties

private data class OutboxRow(
    val id: Long,
    val aggregateId: java.util.UUID,
    val payload: String,
    val correlationId: String,
)

class OutboxRelay(private val config: AppConfig, private val db: Database) {

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

    /** Reads a batch of unpublished rows, publishes each to Kafka, and marks it published only after broker ack. */
    fun pollAndPublishOnce(): Int {
        val rows = transaction(db) {
            Outbox.selectAll()
                .where { Outbox.publishedAt.isNull() }
                .orderBy(Outbox.id)
                .limit(config.outboxBatchSize)
                .map {
                    OutboxRow(
                        id = it[Outbox.id],
                        aggregateId = it[Outbox.aggregateId],
                        payload = it[Outbox.payload],
                        correlationId = it[Outbox.correlationId],
                    )
                }
        }

        var publishedCount = 0
        for (row in rows) {
            val id = row.id
            val aggregateId = row.aggregateId
            val payload = row.payload
            val correlationId = row.correlationId

            val record = ProducerRecord(config.menuEventsTopic, aggregateId.toString(), payload)
            record.headers().add(RecordHeader("correlationId", correlationId.toByteArray()))

            val ackedOffset = producer.send(record).get()

            transaction(db) {
                Outbox.update({ Outbox.id eq id }) {
                    it[publishedAt] = Instant.now()
                }
            }
            publishedCount++
            logger.info("published outbox row id=$id offset=${ackedOffset.offset()}")
        }
        return publishedCount
    }

    fun close() {
        producer.close()
    }
}
