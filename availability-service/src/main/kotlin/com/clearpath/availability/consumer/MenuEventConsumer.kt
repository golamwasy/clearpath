package com.clearpath.availability.consumer

import com.clearpath.availability.AppConfig
import com.clearpath.availability.audit.MongoAuditStore
import com.clearpath.availability.idempotency.IdempotencyStore
import com.clearpath.availability.model.AvailabilityState
import com.clearpath.availability.model.MenuEvent
import com.clearpath.availability.state.RedisAvailabilityStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import org.apache.kafka.clients.consumer.ConsumerConfig
import org.apache.kafka.clients.consumer.KafkaConsumer
import org.apache.kafka.common.serialization.StringDeserializer
import org.slf4j.LoggerFactory
import org.slf4j.MDC
import java.time.Duration
import java.time.Instant
import java.util.Properties
import java.util.UUID

class MenuEventConsumer(
    private val config: AppConfig,
    private val idempotencyStore: IdempotencyStore,
    private val redisStore: RedisAvailabilityStore,
    private val auditStore: MongoAuditStore,
) {
    private val logger = LoggerFactory.getLogger(MenuEventConsumer::class.java)
    private val json = Json { ignoreUnknownKeys = true }

    fun start(scope: CoroutineScope) {
        scope.launch(Dispatchers.IO) {
            val props = Properties().apply {
                put(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, config.kafkaBootstrapServers)
                put(ConsumerConfig.GROUP_ID_CONFIG, config.consumerGroupId)
                put(ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, StringDeserializer::class.java.name)
                put(ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG, StringDeserializer::class.java.name)
                put(ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "earliest")
                put(ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG, "false")
            }
            val consumer = KafkaConsumer<String, String>(props)
            consumer.subscribe(listOf(config.menuEventsTopic))

            try {
                while (isActive) {
                    val records = consumer.poll(Duration.ofMillis(500))
                    for (record in records) {
                        try {
                            processRecord(record.value())
                        } catch (e: Exception) {
                            logger.error("failed to process record, will retry next poll", e)
                        }
                    }
                    if (!records.isEmpty) {
                        consumer.commitSync()
                    }
                }
            } finally {
                consumer.close()
            }
        }
    }

    private fun processRecord(value: String) {
        val event = json.decodeFromString<MenuEvent>(value)
        MDC.put("correlationId", event.correlationId)

        val eventId = UUID.fromString(event.eventId)
        val isNew = idempotencyStore.markProcessedIfNew(eventId, event.eventType)
        if (!isNew) {
            logger.info("skipping already-processed event ${event.eventId}")
            return
        }

        val available = event.eventType != "ItemDeleted"
        val state = AvailabilityState(
            venueId = event.venueId,
            itemId = event.itemId,
            available = available,
            version = event.version,
            updatedAt = Instant.now().toString(),
        )

        redisStore.put(state)
        auditStore.append(event, available)

        logger.info("processed event ${event.eventId} type=${event.eventType} item=${event.itemId}")
    }
}
