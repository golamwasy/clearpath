// Package api exposes pos-ingest's REST endpoints: recent sync runs plus
// the standard health/ready/metrics trio every service in this repo exposes.
package api

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"strconv"

	"github.com/jackc/pgx/v5"

	"github.com/clearpath/pos-ingest/internal/model"
	"github.com/clearpath/pos-ingest/internal/tracing"
)

const correlationIDHeader = "X-Correlation-Id"

type SyncRunLister interface {
	RecentRuns(ctx context.Context, venueID string, limit int) ([]model.SyncRun, error)
	GetRun(ctx context.Context, id string) (model.SyncRun, error)
}

type VenueRetrier interface {
	PollVenueNow(ctx context.Context, venueID string) (model.SyncRun, error)
}

type Pinger interface {
	Ping(ctx context.Context) error
}

// ChaosController is the subset of *worker.Pool the chaos-latency endpoints control.
type ChaosController interface {
	SetChaosLatencyMs(ms int64)
	ChaosLatencyMs() int64
}

type Handlers struct {
	store        SyncRunLister
	retrier      VenueRetrier
	ready        Pinger
	logger       *slog.Logger
	tracer       *tracing.Tracer
	chaos        ChaosController
	chaosEnabled bool
}

func NewHandlers(
	store SyncRunLister,
	retrier VenueRetrier,
	ready Pinger,
	logger *slog.Logger,
	tracer *tracing.Tracer,
	chaos ChaosController,
	chaosEnabled bool,
) *Handlers {
	return &Handlers{
		store:        store,
		retrier:      retrier,
		ready:        ready,
		logger:       logger,
		tracer:       tracer,
		chaos:        chaos,
		chaosEnabled: chaosEnabled,
	}
}

func (h *Handlers) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /sync-runs", h.correlate("GET /sync-runs", h.listSyncRuns))
	mux.HandleFunc("POST /sync-runs/{id}/retry", h.correlate("POST /sync-runs/{id}/retry", h.retrySyncRun))
	mux.HandleFunc("GET /health", h.correlate("GET /health", h.health))
	mux.HandleFunc("GET /ready", h.correlate("GET /ready", h.readyCheck))
	mux.HandleFunc("GET /metrics", h.correlate("GET /metrics", h.metrics))
	mux.HandleFunc("GET /chaos/state", h.correlate("GET /chaos/state", h.chaosState))
	mux.HandleFunc("POST /chaos/latency", h.correlate("POST /chaos/latency", h.setChaosLatency))
	return withCORS(mux)
}

// withCORS lets merchant-web (a browser app on its own origin, e.g. the Vite dev server)
// call this service directly - there's no gateway in front of it - so without this every
// cross-origin fetch is blocked by the browser before it reaches the mux.
func withCORS(next http.Handler) http.Handler {
	allowedOrigin := os.Getenv("CORS_ALLOWED_ORIGIN")
	if allowedOrigin == "" {
		allowedOrigin = "http://localhost:5173"
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", allowedOrigin)
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Correlation-Id")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// correlate ensures every response carries a correlation ID, generating one
// if the caller didn't supply one, matching the header convention used
// across the repo's HTTP surfaces (see menu-service's tracing-core Http.kt
// plugin), and wraps the request in an http-entry span.
func (h *Handlers) correlate(operation string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		correlationID := r.Header.Get(correlationIDHeader)
		if correlationID == "" {
			correlationID = newRequestID()
		}
		w.Header().Set(correlationIDHeader, correlationID)

		ctx := tracing.WithCorrelationID(r.Context(), correlationID)
		_ = h.tracer.WithSpan(ctx, "http."+operation, nil, func(ctx context.Context) error {
			next(w, r.WithContext(ctx))
			return nil
		})
	}
}

func (h *Handlers) listSyncRuns(w http.ResponseWriter, r *http.Request) {
	venueID := r.URL.Query().Get("venue")
	limit := 50
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}

	runs, err := h.store.RecentRuns(r.Context(), venueID, limit)
	if err != nil {
		h.logger.Error("failed to list sync runs", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal_error"})
		return
	}
	writeJSON(w, http.StatusOK, runs)
}

func (h *Handlers) retrySyncRun(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	run, err := h.store.GetRun(r.Context(), id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not_found"})
			return
		}
		h.logger.Error("failed to look up sync run", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal_error"})
		return
	}

	newRun, err := h.retrier.PollVenueNow(r.Context(), run.VenueID)
	if err != nil {
		h.logger.Error("failed to retry venue poll", "venueId", run.VenueID, "error", err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "venue_not_configured"})
		return
	}
	writeJSON(w, http.StatusAccepted, newRun)
}

func (h *Handlers) health(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
}

func (h *Handlers) readyCheck(w http.ResponseWriter, r *http.Request) {
	if err := h.ready.Ping(r.Context()); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "not_ready"})
		return
	}
	w.WriteHeader(http.StatusOK)
}

// metrics is a stub returning placeholder text, not real Prometheus output —
// matching the current stub state of /metrics on menu-service and
// availability-service per CLAUDE.md.
func (h *Handlers) metrics(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; version=0.0.4")
	_, _ = w.Write([]byte("# pos-ingest metrics not yet implemented\n"))
}

// chaosState is the response shape for GET /chaos/state and POST /chaos/latency.
type chaosStateResponse struct {
	ChaosEnabled bool  `json:"chaosEnabled"`
	LatencyMs    int64 `json:"latencyMs"`
}

type setLatencyRequest struct {
	Ms int64 `json:"ms"`
}

func (h *Handlers) chaosState(w http.ResponseWriter, r *http.Request) {
	if !h.chaosEnabled {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	writeJSON(w, http.StatusOK, chaosStateResponse{ChaosEnabled: h.chaosEnabled, LatencyMs: h.chaos.ChaosLatencyMs()})
}

// setChaosLatency injects (or clears, with ms=0) artificial delay before each venue poll —
// the pos-ingest half of the chaos panel. Guarded by CHAOS_ENABLED, 404s otherwise so the
// surface isn't advertised. See docs/adr/0005-observability-ui.md.
func (h *Handlers) setChaosLatency(w http.ResponseWriter, r *http.Request) {
	if !h.chaosEnabled {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	var req setLatencyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Ms < 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid ms"})
		return
	}
	h.chaos.SetChaosLatencyMs(req.Ms)
	writeJSON(w, http.StatusOK, chaosStateResponse{ChaosEnabled: h.chaosEnabled, LatencyMs: h.chaos.ChaosLatencyMs()})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
