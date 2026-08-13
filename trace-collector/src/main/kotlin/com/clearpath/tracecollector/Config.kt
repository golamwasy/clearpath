package com.clearpath.tracecollector

data class AppConfig(
    val kafkaBootstrapServers: String = System.getenv("KAFKA_BOOTSTRAP_SERVERS") ?: "localhost:9092",
    val systemTraceTopic: String = System.getenv("SYSTEM_TRACE_TOPIC") ?: "system.trace",
    val consumerGroupId: String = System.getenv("TRACE_COLLECTOR_CONSUMER_GROUP") ?: "trace-collector",
    val mongoUri: String = System.getenv("MONGO_URI") ?: "mongodb://localhost:27017",
    val mongoDatabase: String = System.getenv("MONGO_DATABASE") ?: "tracing",
    val httpPort: Int = System.getenv("TRACE_COLLECTOR_HTTP_PORT")?.toIntOrNull() ?: 8084,
    // groupId:topic pairs, comma-separated. Defaults to the two consumer groups that actually
    // exist today — see docs/adr/0005-observability-ui.md ("lag reflects exactly two consumer
    // groups because those are the only two that exist").
    val monitoredConsumerGroups: String =
        System.getenv("MONITORED_CONSUMER_GROUPS") ?: "availability-service:menu.events,trace-collector:system.trace",
)

