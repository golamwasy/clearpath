package com.clearpath.tracecollector.model

import kotlinx.serialization.Serializable

@Serializable
data class TraceSummary(
    val correlationId: String,
    val startedAt: String,
    val finishedAt: String,
    val durationMs: Long,
    val spanCount: Int,
    val status: String,
)
