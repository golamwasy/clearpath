package com.clearpath.availability.consumer

import com.clearpath.availability.AppConfig
import com.clearpath.availability.audit.MongoAuditStore
import com.clearpath.availability.chaos.CapturedEvent
import com.clearpath.availability.chaos.ChaosState
import com.clearpath.availability.idempotency.IdempotencyStore
import com.clearpath.availability.model.AvailabilityState
import com.clearpath.availability.model.AvailabilityStatus
import com.clearpath.availability.model.MenuEvent
import com.clearpath.availability.state.RedisAvailabilityStore
import com.clearpath.tracing.SpanAttributes
import com.clearpath.tracing.TraceContext
import com.clearpath.tracing.Tracer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
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

/** Outcome of processing one menu.events record — returned to the duplicate-delivery chaos route. */
data class EventOutcome(
    val eventId: String,
    val itemId: String,
    val correlationId: String,
    val accepted: Boolean,
    val reason: String,
)

class MenuEventConsumer(
    private val config: AppConfig,
    private val idempotencyStore: IdempotencyStore,
    private val redisStore: RedisAvailabilityStore,
    private val auditStore: MongoAuditStore,
    private val tracer: Tracer,
    private val chaosState: ChaosState,
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
                    // Chaos: pausing stops fetching entirely (not just processing), so the
                    // committed offset falls behind the topic's log end offset and lag genuinely
                    // grows — visible on the flow view's lag panel. See docs/adr/0005.
                    if (chaosState.consumerPaused.get()) {
                        delay(500)
                        continue
                    }
                    val records = consumer.poll(Duration.ofMillis(500))
                    for (record in records) {
                        try {
                            processRecord(record.value(), record.partition())
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

    private suspend fun processRecord(value: String, partition: Int) {
        chaosState.lastEvent = CapturedEvent(value, partition)
        handleEvent(value, partition)
    }

    /**
     * Replays the last raw record this consumer processed through the identical path — the
     * duplicate-delivery chaos action. Since [com.clearpath.availability.idempotency.IdempotencyStore]
     * is keyed on the event's own eventId, this always comes back `accepted = false`: proof the
     * dedupe check rejects a byte-identical redelivery. Returns null if nothing has been
     * processed yet this run. See docs/adr/0005-observability-ui.md.
     */
    suspend fun replayLastEvent(): EventOutcome? {
        val captured = chaosState.lastEvent ?: return null
        return handleEvent(captured.rawJson, captured.partition)
    }

    private suspend fun handleEvent(rawJson: String, partition: Int): EventOutcome {
        val event = json.decodeFromString<MenuEvent>(rawJson)
        MDC.put("correlationId", event.correlationId)

        val attrs = SpanAttributes(idempotencyKey = event.eventId, kafkaPartition = partition)

        // menu.events carries a correlationId but no spanId, so the consume span's parent is
        // unrecoverable — it's emitted with root=true even though it isn't the trace's origin.
        return tracer.withSpan(TraceContext.root(event.correlationId), "kafka.consume ${config.menuEventsTopic}", attrs) { ctx ->
            val eventId = UUID.fromString(event.eventId)
            val isNew = idempotencyStore.markProcessedIfNew(eventId, event.eventType, ctx)
            if (!isNew) {
                logger.info("skipping already-processed event ${event.eventId}")
                return@withSpan EventOutcome(
                    event.eventId,
                    event.itemId,
                    event.correlationId,
                    accepted = false,
                    reason = "already processed",
                )
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
            EventOutcome(event.eventId, event.itemId, event.correlationId, accepted = true, reason = "processed")
        }
    }
}
