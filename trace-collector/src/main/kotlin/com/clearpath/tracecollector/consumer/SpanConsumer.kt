package com.clearpath.tracecollector.consumer

import com.clearpath.tracecollector.AppConfig
import com.clearpath.tracecollector.sse.SpanBroadcaster
import com.clearpath.tracecollector.store.SpanStore
import com.clearpath.tracing.Span
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
import java.time.Duration
import java.util.Properties

class SpanConsumer(
    private val config: AppConfig,
    private val store: SpanStore,
    private val broadcaster: SpanBroadcaster,
) {
    private val logger = LoggerFactory.getLogger(SpanConsumer::class.java)
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
            consumer.subscribe(listOf(config.systemTraceTopic))

            try {
                while (isActive) {
                    val records = consumer.poll(Duration.ofMillis(500))
                    var anyFailed = false
                    for (record in records) {
                        try {
                            processRecord(record.value())
                        } catch (e: Exception) {
                            anyFailed = true
                            logger.error("failed to process span record, will retry next poll", e)
                        }
                    }
                    // Skip the commit for the whole batch if anything failed, so the offset never
                    // advances past a record that was never actually stored — matches the fix in
                    // availability-service's MenuEventConsumer.
                    if (!records.isEmpty && !anyFailed) {
                        consumer.commitSync()
                    }
                }
            } finally {
                consumer.close()
            }
        }
    }

    private suspend fun processRecord(value: String) {
        val span: Span = json.decodeFromString(value)
        store.insert(span)
        broadcaster.publish(span)
    }
}
