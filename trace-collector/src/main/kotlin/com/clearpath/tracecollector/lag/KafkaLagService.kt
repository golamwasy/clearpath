package com.clearpath.tracecollector.lag

import kotlinx.serialization.Serializable
import org.apache.kafka.clients.admin.AdminClient
import org.apache.kafka.clients.admin.OffsetSpec
import org.apache.kafka.common.TopicPartition
import org.slf4j.LoggerFactory
import java.util.concurrent.TimeUnit

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

    private val logger = LoggerFactory.getLogger(KafkaLagService::class.java)

    // A failed group is omitted, not reported as some sentinel lag value: merchant-web renders
    // lag <= 0 as a healthy green badge (FlowDiagram.tsx), so a numeric stand-in for "couldn't
    // compute this" would read as "no lag" — worse than showing nothing for that node.
    fun currentLag(): List<ConsumerGroupLag> = monitoredGroups.mapNotNull { safeLagForGroup(it) }

    /**
     * Lag for one group, for a per-group Prometheus gauge — see Application.kt's registry setup.
     * Never throws: a Micrometer gauge supplier that throws takes the whole scrape down with it,
     * so a Kafka outage would silently break every other metric on this endpoint too, not just
     * this one gauge. -1 is this gauge's own "couldn't compute" sentinel — Prometheus gauges can't
     * omit a sample the way the JSON list above can, so a negative value (impossible for real lag)
     * is the convention here instead.
     */
    fun currentLagFor(group: MonitoredGroup): Long = safeLagForGroup(group)?.lag ?: -1

    private fun safeLagForGroup(group: MonitoredGroup): ConsumerGroupLag? =
        try {
            lagForGroup(group)
        } catch (e: Exception) {
            logger.warn("failed to compute consumer lag for group=${group.groupId} topic=${group.topic}", e)
            null
        }

    private fun lagForGroup(group: MonitoredGroup): ConsumerGroupLag {
        // Bounded so a Kafka outage can't hang this call forever — this is reachable from the
        // /metrics scrape path, and a metrics endpoint that can hang on the thing it measures
        // defeats the point of having it.
        val committedOffsets = admin.listConsumerGroupOffsets(group.groupId)
            .partitionsToOffsetAndMetadata()
            .get(ADMIN_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        val topicPartitions = committedOffsets.keys.filter { it.topic() == group.topic }
        if (topicPartitions.isEmpty()) {
            return ConsumerGroupLag(group.groupId, group.topic, lag = 0, partitions = emptyList())
        }

        val endOffsetSpecs: Map<TopicPartition, OffsetSpec> = topicPartitions.associateWith { OffsetSpec.latest() }
        val endOffsets = admin.listOffsets(endOffsetSpecs).all().get(ADMIN_TIMEOUT_SECONDS, TimeUnit.SECONDS)

        val partitionLags = topicPartitions
            .map { tp ->
                val committed = committedOffsets[tp]?.offset() ?: 0L
                val end = endOffsets[tp]?.offset() ?: committed
                PartitionLag(tp.partition(), (end - committed).coerceAtLeast(0))
            }
            .sortedBy { it.partition }

        return ConsumerGroupLag(group.groupId, group.topic, lag = partitionLags.sumOf { it.lag }, partitions = partitionLags)
    }

    companion object {
        private const val ADMIN_TIMEOUT_SECONDS = 5L
    }
}
