package com.clearpath.tracecollector.routes

import com.clearpath.tracecollector.lag.KafkaLagService
import io.ktor.server.application.call
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get

fun Route.lagRoutes(lagService: KafkaLagService) {
    get("/consumer-lag") {
        call.respond(lagService.currentLag())
    }
}
