package com.clearpath.tracecollector

data class AppConfig(
    val kafkaBootstrapServers: String = System.getenv("KAFKA_BOOTSTRAP_SERVERS") ?: "localhost:9092",
    val systemTraceTopic: String = System.getenv("SYSTEM_TRACE_TOPIC") ?: "system.trace",
    val consumerGroupId: String = System.getenv("TRACE_COLLECTOR_CONSUMER_GROUP") ?: "trace-collector",
    val mongoUri: String = System.getenv("MONGO_URI") ?: "mongodb://localhost:27017",
    val mongoDatabase: String = System.getenv("MONGO_DATABASE") ?: "tracing",
    val httpPort: Int = System.getenv("TRACE_COLLECTOR_HTTP_PORT")?.toIntOrNull() ?: 8084,
)
