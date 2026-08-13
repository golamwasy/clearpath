// Package metrics wires up this service's Prometheus registry. A single
// package-level registry (not the global default one) keeps registration
// explicit and testable, matching this repo's general preference for
// explicit wiring over ambient globals.
package metrics

import (
	"net/http"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

var Registry = prometheus.NewRegistry()

var (
	HTTPRequestsTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "pos_ingest_http_requests_total",
			Help: "HTTP requests by route and status code",
		},
		[]string{"route", "status"},
	)
	HTTPRequestDuration = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "pos_ingest_http_request_duration_seconds",
			Help:    "HTTP request latency by route",
			Buckets: prometheus.DefBuckets,
		},
		[]string{"route"},
	)
	// A cumulative count, not a queue-depth gauge: true DLQ depth would need consumer-group lag
	// on pos.sync.dlq, but nothing consumes that topic (see CLAUDE.md and the Grafana dashboard
	// notes) — documented as a simplification rather than faked as a gauge.
	DLQPublishedTotal = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "pos_ingest_dlq_published_total",
		Help: "Cumulative count of sync failures published to pos.sync.dlq after retry exhaustion",
	})
)

func init() {
	Registry.MustRegister(HTTPRequestsTotal, HTTPRequestDuration, DLQPublishedTotal)
}

func Handler() http.Handler {
	return promhttp.HandlerFor(Registry, promhttp.HandlerOpts{})
}
