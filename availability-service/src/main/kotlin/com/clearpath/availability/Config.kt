package com.clearpath.availability

data class AppConfig(
    val dbUrl: String = System.getenv("AVAILABILITY_DB_URL") ?: "jdbc:postgresql://localhost:5432/availability",
    val dbUser: String = System.getenv("AVAILABILITY_DB_USER") ?: "availability",
    val dbPassword: String = System.getenv("AVAILABILITY_DB_PASSWORD") ?: "availability",
    val kafkaBootstrapServers: String = System.getenv("KAFKA_BOOTSTRAP_SERVERS") ?: "localhost:9092",
    val menuEventsTopic: String = System.getenv("MENU_EVENTS_TOPIC") ?: "menu.events",
    val systemTraceTopic: String = System.getenv("SYSTEM_TRACE_TOPIC") ?: "system.trace",
    val consumerGroupId: String = System.getenv("AVAILABILITY_CONSUMER_GROUP") ?: "availability-service",
    val redisHost: String = System.getenv("REDIS_HOST") ?: "localhost",
    val redisPort: Int = System.getenv("REDIS_PORT")?.toIntOrNull() ?: 6379,
    val mongoUri: String = System.getenv("MONGO_URI") ?: "mongodb://localhost:27017",
    val mongoDatabase: String = System.getenv("MONGO_DATABASE") ?: "availability",
    val httpPort: Int = System.getenv("AVAILABILITY_HTTP_PORT")?.toIntOrNull() ?: 8082,
)
