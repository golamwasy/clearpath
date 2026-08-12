package com.clearpath.menu

data class AppConfig(
    val dbUrl: String = System.getenv("MENU_DB_URL") ?: "jdbc:postgresql://localhost:5432/menu",
    val dbUser: String = System.getenv("MENU_DB_USER") ?: "menu",
    val dbPassword: String = System.getenv("MENU_DB_PASSWORD") ?: "menu",
    val kafkaBootstrapServers: String = System.getenv("KAFKA_BOOTSTRAP_SERVERS") ?: "localhost:9092",
    val menuEventsTopic: String = System.getenv("MENU_EVENTS_TOPIC") ?: "menu.events",
    val systemTraceTopic: String = System.getenv("SYSTEM_TRACE_TOPIC") ?: "system.trace",
    val httpPort: Int = System.getenv("MENU_HTTP_PORT")?.toIntOrNull() ?: 8081,
    val outboxPollIntervalMs: Long = System.getenv("OUTBOX_POLL_INTERVAL_MS")?.toLongOrNull() ?: 500L,
    val outboxBatchSize: Int = System.getenv("OUTBOX_BATCH_SIZE")?.toIntOrNull() ?: 50,
)
