package com.clearpath.availability.state

import com.clearpath.availability.chaos.ChaosState
import com.clearpath.availability.model.AvailabilityState
import com.clearpath.tracing.TraceContext
import com.clearpath.tracing.Tracer
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import redis.clients.jedis.JedisPool
import redis.clients.jedis.exceptions.JedisConnectionException

class RedisAvailabilityStore(
    private val pool: JedisPool,
    private val tracer: Tracer,
    private val chaosState: ChaosState,
) {

    private val json = Json { ignoreUnknownKeys = true }

    private fun key(venueId: String, itemId: String) = "availability:$venueId:$itemId"

    // Simulated in-process, not by severing the docker-compose network path to redis: the
    // JedisPool is constructed once at startup and isn't practical to re-point at a bad host.
    // Throwing before touching the pool produces the same externally-observable failure. See
    // docs/adr/0005-observability-ui.md.
    private fun failIfChaosRedisUnreachable() {
        if (chaosState.redisUnreachable.get()) {
            throw JedisConnectionException("simulated Redis outage (chaos panel)")
        }
    }

    suspend fun put(state: AvailabilityState, ctx: TraceContext) {
        failIfChaosRedisUnreachable()
        tracer.withSpan(ctx, "redis.write availability") {
            pool.resource.use { jedis ->
                jedis.set(key(state.venueId, state.itemId), json.encodeToString(state))
            }
        }
    }

    fun get(venueId: String, itemId: String): AvailabilityState? {
        failIfChaosRedisUnreachable()
        return pool.resource.use { jedis ->
            jedis.get(key(venueId, itemId))?.let { json.decodeFromString<AvailabilityState>(it) }
        }
    }

    fun listForVenue(venueId: String): List<AvailabilityState> {
        failIfChaosRedisUnreachable()
        return pool.resource.use { jedis ->
            val keys = jedis.keys("availability:$venueId:*")
            keys.mapNotNull { k -> jedis.get(k)?.let { json.decodeFromString<AvailabilityState>(it) } }
        }
    }
}
