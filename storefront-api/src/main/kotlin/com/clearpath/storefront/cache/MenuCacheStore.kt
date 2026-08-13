package com.clearpath.storefront.cache

import com.clearpath.storefront.model.StorefrontMenuResponse
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import redis.clients.jedis.JedisPool
import redis.clients.jedis.params.SetParams

class MenuCacheStore(private val pool: JedisPool, private val ttlSeconds: Long) {

    private val json = Json { ignoreUnknownKeys = true }

    private fun key(venueId: String) = "storefront:menu:$venueId"

    fun get(venueId: String): StorefrontMenuResponse? =
        pool.resource.use { jedis ->
            jedis.get(key(venueId))?.let { json.decodeFromString<StorefrontMenuResponse>(it) }
        }

    fun put(response: StorefrontMenuResponse) {
        pool.resource.use { jedis ->
            jedis.set(key(response.venueId), json.encodeToString(response), SetParams().ex(ttlSeconds))
        }
    }
}
