package com.clearpath.storefront

data class AppConfig(
    val menuServiceUrl: String = System.getenv("MENU_SERVICE_URL") ?: "http://localhost:8081",
    val availabilityServiceUrl: String = System.getenv("AVAILABILITY_SERVICE_URL") ?: "http://localhost:8082",
    val kafkaBootstrapServers: String = System.getenv("KAFKA_BOOTSTRAP_SERVERS") ?: "localhost:9092",
    val systemTraceTopic: String = System.getenv("SYSTEM_TRACE_TOPIC") ?: "system.trace",
    val redisHost: String = System.getenv("REDIS_HOST") ?: "localhost",
    val redisPort: Int = System.getenv("REDIS_PORT")?.toIntOrNull() ?: 6379,
    // Deliberately short — this is a cache for a read-composition endpoint, not a source of
    // truth; freshness matters more than hit rate at this phase. See docs/adr/0007.
    val menuCacheTtlSeconds: Long = System.getenv("STOREFRONT_MENU_CACHE_TTL_SECONDS")?.toLongOrNull() ?: 5,
    val httpPort: Int = System.getenv("STOREFRONT_HTTP_PORT")?.toIntOrNull() ?: 8085,
)
