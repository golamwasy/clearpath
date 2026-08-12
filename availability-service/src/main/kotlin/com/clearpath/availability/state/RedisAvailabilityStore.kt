package com.clearpath.availability.state

import com.clearpath.availability.model.AvailabilityState
import com.clearpath.tracing.TraceContext
import com.clearpath.tracing.Tracer
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import redis.clients.jedis.JedisPool

class RedisAvailabilityStore(private val pool: JedisPool, private val tracer: Tracer) {

    private val json = Json { ignoreUnknownKeys = true }

    private fun key(venueId: String, itemId: String) = "availability:$venueId:$itemId"

    suspend fun put(state: AvailabilityState, ctx: TraceContext) {
        tracer.withSpan(ctx, "redis.write availability") {
            pool.resource.use { jedis ->
                jedis.set(key(state.venueId, state.itemId), json.encodeToString(state))
            }
        }
    }

    fun get(venueId: String, itemId: String): AvailabilityState? =
        pool.resource.use { jedis ->
            jedis.get(key(venueId, itemId))?.let { json.decodeFromString<AvailabilityState>(it) }
        }

    fun listForVenue(venueId: String): List<AvailabilityState> =
        pool.resource.use { jedis ->
            val keys = jedis.keys("availability:$venueId:*")
            keys.mapNotNull { k -> jedis.get(k)?.let { json.decodeFromString<AvailabilityState>(it) } }
        }
}
