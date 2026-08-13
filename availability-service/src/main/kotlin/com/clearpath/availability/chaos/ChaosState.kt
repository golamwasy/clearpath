package com.clearpath.availability.chaos

import java.util.concurrent.atomic.AtomicBoolean

/** The last raw menu.events JSON payload processed, cached for the duplicate-delivery chaos action. */
data class CapturedEvent(val rawJson: String, val partition: Int)

/**
 * In-process fault-injection flags for the chaos panel. Read by [com.clearpath.availability.consumer.MenuEventConsumer]
 * and [com.clearpath.availability.state.RedisAvailabilityStore], mutated by the chaos routes — every
 * mutation is guarded end-to-end by `AppConfig.chaosEnabled` at the route layer, not here.
 * See docs/adr/0005-observability-ui.md.
 */
class ChaosState {
    val consumerPaused = AtomicBoolean(false)
    val redisUnreachable = AtomicBoolean(false)

    @Volatile
    var lastEvent: CapturedEvent? = null
}
