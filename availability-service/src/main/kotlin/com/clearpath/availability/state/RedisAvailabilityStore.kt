package com.clearpath.availability.state

import com.clearpath.availability.model.AvailabilityState
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import redis.clients.jedis.JedisPool

class RedisAvailabilityStore(private val pool: JedisPool) {

    private val json = Json { ignoreUnknownKeys = true }

    private fun key(venueId: String, itemId: String) = "availability:$venueId:$itemId"

    fun put(state: AvailabilityState) {
        pool.resource.use { jedis ->
            jedis.set(key(state.venueId, state.itemId), json.encodeToString(state))
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
