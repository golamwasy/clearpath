package com.clearpath.tracecollector.lag

import kotlinx.serialization.Serializable
import org.apache.kafka.clients.admin.AdminClient
import org.apache.kafka.clients.admin.OffsetSpec
import org.apache.kafka.common.TopicPartition

data class MonitoredGroup(val groupId: String, val topic: String)

/** Parses the "groupId:topic,groupId:topic" form of AppConfig.monitoredConsumerGroups. */
fun parseMonitoredGroups(spec: String): List<MonitoredGroup> =
    spec.split(",")
        .map { it.trim() }
        .filter { it.isNotEmpty() }
        .map { pair ->
            val (groupId, topic) = pair.split(":", limit = 2)
            MonitoredGroup(groupId.trim(), topic.trim())
        }

@Serializable
data class PartitionLag(val partition: Int, val lag: Long)

@Serializable
data class ConsumerGroupLag(val groupId: String, val topic: String, val lag: Long, val partitions: List<PartitionLag>)

/**
 * Computes Kafka consumer lag via AdminClient — already on the classpath transitively through
 * kafka-clients (the same jar KafkaConsumer comes from in SpanConsumer.kt), no new dependency.
 * Computed fresh on every call, not cached — request volume here is a merchant looking at a
 * dashboard, not production monitoring traffic. See docs/adr/0005-observability-ui.md.
 */
class KafkaLagService(private val admin: AdminClient, val monitoredGroups: List<MonitoredGroup>) {

    fun currentLag(): List<ConsumerGroupLag> = monitoredGroups.map { lagForGroup(it) }

    /** Lag for one group, for a per-group Prometheus gauge — see Application.kt's registry setup. */
    fun currentLagFor(group: MonitoredGroup): Long = lagForGroup(group).lag

    private fun lagForGroup(group: MonitoredGroup): ConsumerGroupLag {
        val committedOffsets = admin.listConsumerGroupOffsets(group.groupId)
            .partitionsToOffsetAndMetadata()
            .get()
        val topicPartitions = committedOffsets.keys.filter { it.topic() == group.topic }
        if (topicPartitions.isEmpty()) {
            return ConsumerGroupLag(group.groupId, group.topic, lag = 0, partitions = emptyList())
        }

        val endOffsetSpecs: Map<TopicPartition, OffsetSpec> = topicPartitions.associateWith { OffsetSpec.latest() }
        val endOffsets = admin.listOffsets(endOffsetSpecs).all().get()

        val partitionLags = topicPartitions
            .map { tp ->
                val committed = committedOffsets[tp]?.offset() ?: 0L
                val end = endOffsets[tp]?.offset() ?: committed
                PartitionLag(tp.partition(), (end - committed).coerceAtLeast(0))
            }
            .sortedBy { it.partition }

        return ConsumerGroupLag(group.groupId, group.topic, lag = partitionLags.sumOf { it.lag }, partitions = partitionLags)
    }
}
