// Package api exposes pos-ingest's REST endpoints: recent sync runs plus
// the standard health/ready/metrics trio every service in this repo exposes.
package api

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/clearpath/pos-ingest/internal/model"
)

const correlationIDHeader = "X-Correlation-Id"

type SyncRunLister interface {
	RecentRuns(ctx context.Context, venueID string, limit int) ([]model.SyncRun, error)
}

type Pinger interface {
	Ping(ctx context.Context) error
}

type Handlers struct {
	store  SyncRunLister
	ready  Pinger
	logger *slog.Logger
}

func NewHandlers(store SyncRunLister, ready Pinger, logger *slog.Logger) *Handlers {
	return &Handlers{store: store, ready: ready, logger: logger}
}

func (h *Handlers) Routes() *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /sync-runs", h.correlate(h.listSyncRuns))
	mux.HandleFunc("GET /health", h.health)
	mux.HandleFunc("GET /ready", h.readyCheck)
	mux.HandleFunc("GET /metrics", h.metrics)
	return mux
}

// correlate ensures every response carries a correlation ID, generating one
// if the caller didn't supply one, matching the header convention used
// across the repo's HTTP surfaces (see menu-service Correlation.kt).
func (h *Handlers) correlate(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		correlationID := r.Header.Get(correlationIDHeader)
		if correlationID == "" {
			correlationID = newRequestID()
		}
		w.Header().Set(correlationIDHeader, correlationID)
		next(w, r)
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

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
