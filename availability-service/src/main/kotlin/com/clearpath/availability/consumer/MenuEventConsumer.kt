package com.clearpath.availability.consumer

import com.clearpath.availability.AppConfig
import com.clearpath.availability.audit.MongoAuditStore
import com.clearpath.availability.idempotency.IdempotencyStore
import com.clearpath.availability.model.AvailabilityState
import com.clearpath.availability.model.AvailabilityStatus
import com.clearpath.availability.model.MenuEvent
import com.clearpath.availability.state.RedisAvailabilityStore
import com.clearpath.tracing.TraceContext
import com.clearpath.tracing.Tracer
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
    private val tracer: Tracer,
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

    private suspend fun processRecord(value: String) {
        val event = json.decodeFromString<MenuEvent>(value)
        MDC.put("correlationId", event.correlationId)

        // menu.events carries a correlationId but no spanId, so the consume span's parent is
        // unrecoverable — it's emitted with root=true even though it isn't the trace's origin.
        tracer.withSpan(TraceContext.root(event.correlationId), "kafka.consume ${config.menuEventsTopic}") { ctx ->
            val eventId = UUID.fromString(event.eventId)
            val isNew = idempotencyStore.markProcessedIfNew(eventId, event.eventType, ctx)
            if (!isNew) {
                logger.info("skipping already-processed event ${event.eventId}")
                return@withSpan
            }

            val status = if (event.eventType == "ItemDeleted") AvailabilityStatus.SOLD_OUT else AvailabilityStatus.IN_STOCK
            val state = AvailabilityState(
                venueId = event.venueId,
                itemId = event.itemId,
                status = status,
                soldOutUntil = null,
                version = event.version,
                updatedAt = Instant.now().toString(),
            )

            redisStore.put(state, ctx)
            auditStore.append(event, status)

            logger.info("processed event ${event.eventId} type=${event.eventType} item=${event.itemId}")
        }
    }
}
