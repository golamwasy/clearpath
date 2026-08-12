package com.clearpath.integration

import com.clearpath.availability.AppConfig as AvailabilityConfig
import com.clearpath.availability.audit.MongoAuditStore
import com.clearpath.availability.consumer.MenuEventConsumer
import com.clearpath.availability.db.DatabaseFactory as AvailabilityDatabaseFactory
import com.clearpath.availability.idempotency.IdempotencyStore
import com.clearpath.availability.moduleWith as availabilityModule
import com.clearpath.availability.state.RedisAvailabilityStore
import com.clearpath.menu.AppConfig as MenuConfig
import com.clearpath.menu.db.DatabaseFactory as MenuDatabaseFactory
import com.clearpath.menu.moduleWith as menuModule
import com.clearpath.menu.outbox.OutboxRelay
import com.mongodb.kotlin.client.coroutine.MongoClient
import io.ktor.server.engine.embeddedServer
import io.ktor.server.netty.Netty
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.testcontainers.containers.KafkaContainer
import org.testcontainers.containers.MongoDBContainer
import org.testcontainers.containers.PostgreSQLContainer
import org.testcontainers.containers.GenericContainer
import org.testcontainers.utility.DockerImageName
import redis.clients.jedis.JedisPool
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration

class WritePathIntegrationTest {

    companion object {
        private val menuPostgres = PostgreSQLContainer(DockerImageName.parse("postgres:16-alpine"))
        private val availabilityPostgres = PostgreSQLContainer(DockerImageName.parse("postgres:16-alpine"))
        private val redisContainer = GenericContainer(DockerImageName.parse("redis:7-alpine")).withExposedPorts(6379)
        private val mongoContainer = MongoDBContainer(DockerImageName.parse("mongo:7"))
        private val kafkaContainer = KafkaContainer(DockerImageName.parse("confluentinc/cp-kafka:7.7.0"))

        private lateinit var menuServer: io.ktor.server.engine.ApplicationEngine
        private lateinit var availabilityServer: io.ktor.server.engine.ApplicationEngine
        private lateinit var jedisPool: JedisPool
        private const val MENU_HTTP_PORT = 18081

        @JvmStatic
        @BeforeAll
        fun setUp() {
            menuPostgres.start()
            availabilityPostgres.start()
            redisContainer.start()
            mongoContainer.start()
            kafkaContainer.start()

            val menuConfig = MenuConfig(
                dbUrl = menuPostgres.jdbcUrl,
                dbUser = menuPostgres.username,
                dbPassword = menuPostgres.password,
                kafkaBootstrapServers = kafkaContainer.bootstrapServers,
                menuEventsTopic = "menu.events",
                httpPort = MENU_HTTP_PORT,
                outboxPollIntervalMs = 200,
                outboxBatchSize = 50,
            )
            val menuDb = MenuDatabaseFactory.connect(menuConfig)
            val relay = OutboxRelay(menuConfig, menuDb)
            menuServer = embeddedServer(Netty, port = menuConfig.httpPort) {
                menuModule(menuDb, relay)
            }.start(wait = false)

            val availabilityConfig = AvailabilityConfig(
                dbUrl = availabilityPostgres.jdbcUrl,
                dbUser = availabilityPostgres.username,
                dbPassword = availabilityPostgres.password,
                kafkaBootstrapServers = kafkaContainer.bootstrapServers,
                menuEventsTopic = "menu.events",
                consumerGroupId = "availability-service-test",
                redisHost = redisContainer.host,
                redisPort = redisContainer.getMappedPort(6379),
                mongoUri = mongoContainer.connectionString,
                mongoDatabase = "availability",
                httpPort = 18082,
            )
            val availabilityDb = AvailabilityDatabaseFactory.connect(availabilityConfig)
            jedisPool = JedisPool(availabilityConfig.redisHost, availabilityConfig.redisPort)
            val mongoClient = MongoClient.create(availabilityConfig.mongoUri)
            val redisStore = RedisAvailabilityStore(jedisPool)
            val auditStore = MongoAuditStore(mongoClient.getDatabase(availabilityConfig.mongoDatabase))
            val idempotencyStore = IdempotencyStore(availabilityDb)
            val consumer = MenuEventConsumer(availabilityConfig, idempotencyStore, redisStore, auditStore)

            availabilityServer = embeddedServer(Netty, port = availabilityConfig.httpPort) {
                availabilityModule(consumer, redisStore)
            }.start(wait = false)
        }

        @JvmStatic
        @AfterAll
        fun tearDown() {
            if (::menuServer.isInitialized) menuServer.stop(500, 1000)
            if (::availabilityServer.isInitialized) availabilityServer.stop(500, 1000)
            if (::jedisPool.isInitialized) jedisPool.close()
            menuPostgres.stop()
            availabilityPostgres.stop()
            redisContainer.stop()
            mongoContainer.stop()
            kafkaContainer.stop()
        }
    }

    private val httpClient = HttpClient.newHttpClient()
    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `item written via menu-service REST API appears in availability-service Redis state`() {
        val venueRequest = HttpRequest.newBuilder()
            .uri(URI.create("http://localhost:$MENU_HTTP_PORT/venues"))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString("""{"name":"Test Diner"}"""))
            .build()
        val venueResponse = httpClient.send(venueRequest, HttpResponse.BodyHandlers.ofString())
        assertEquals(201, venueResponse.statusCode(), "venue creation failed: ${venueResponse.body()}")
        val venueId = json.parseToJsonElement(venueResponse.body()).jsonObject["id"]!!.jsonPrimitive.content

        val itemRequest = HttpRequest.newBuilder()
            .uri(URI.create("http://localhost:$MENU_HTTP_PORT/venues/$venueId/items"))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString("""{"name":"Cheeseburger","description":"with fries"}"""))
            .build()
        val itemResponse = httpClient.send(itemRequest, HttpResponse.BodyHandlers.ofString())
        assertEquals(201, itemResponse.statusCode(), "item creation failed: ${itemResponse.body()}")
        val itemId = json.parseToJsonElement(itemResponse.body()).jsonObject["id"]!!.jsonPrimitive.content

        val deadline = System.currentTimeMillis() + Duration.ofSeconds(30).toMillis()
        var found: String? = null
        while (System.currentTimeMillis() < deadline) {
            jedisPool.resource.use { jedis ->
                found = jedis.get("availability:$venueId:$itemId")
            }
            if (found != null) break
            Thread.sleep(300)
        }

        assertNotNull(found, "item did not appear in Redis availability state within timeout")
        val availabilityJson = json.parseToJsonElement(found!!).jsonObject
        assertEquals(venueId, availabilityJson["venueId"]!!.jsonPrimitive.content)
        assertEquals(itemId, availabilityJson["itemId"]!!.jsonPrimitive.content)
        assertEquals(true, availabilityJson["available"]!!.jsonPrimitive.boolean, "expected item to be available")
    }
}
