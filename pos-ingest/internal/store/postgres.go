// Package store persists sync run history to Postgres.
package store

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/clearpath/pos-ingest/internal/model"
	"github.com/clearpath/pos-ingest/internal/tracing"
)

// migrationSQL mirrors migrations/0001_sync_runs.sql (kept as a plain file
// too, for anyone applying it manually via psql). Applied idempotently on
// every startup via IF NOT EXISTS, mirroring what menu-service's Flyway
// migration does automatically on connect — without pulling in a migration
// framework dependency, per the Go conventions in CLAUDE.md.
const migrationSQL = `
CREATE TABLE IF NOT EXISTS sync_runs (
    id             UUID PRIMARY KEY,
    venue_id       TEXT NOT NULL,
    provider       TEXT NOT NULL,
    started_at     TIMESTAMPTZ NOT NULL,
    finished_at    TIMESTAMPTZ,
    items_changed  INT NOT NULL DEFAULT 0,
    status         TEXT NOT NULL,
    error          TEXT,
    correlation_id TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS sync_runs_venue_started_idx ON sync_runs (venue_id, started_at DESC);
`

type Store struct {
	pool   *pgxpool.Pool
	tracer *tracing.Tracer
}

func New(ctx context.Context, dbURL string, tracer *tracing.Tracer) (*Store, error) {
	pool, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		return nil, fmt.Errorf("connect postgres: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping postgres: %w", err)
	}
	if _, err := pool.Exec(ctx, migrationSQL); err != nil {
		pool.Close()
		return nil, fmt.Errorf("apply migration: %w", err)
	}
	return &Store{pool: pool, tracer: tracer}, nil
}

func (s *Store) Close() {
	s.pool.Close()
}

func (s *Store) Ping(ctx context.Context) error {
	return s.pool.Ping(ctx)
}

// StartRun inserts a sync_runs row with status=running and returns it.
func (s *Store) StartRun(ctx context.Context, venueID, provider, correlationID string) (model.SyncRun, error) {
	var run model.SyncRun
	err := s.tracer.WithSpan(ctx, "db.commit sync_runs", func(ctx context.Context) error {
		run = model.SyncRun{
			ID:            newUUID(),
			VenueID:       venueID,
			Provider:      provider,
			StartedAt:     time.Now().UTC(),
			Status:        model.SyncStatusRunning,
			CorrelationID: correlationID,
		}
		_, err := s.pool.Exec(ctx, `
			INSERT INTO sync_runs (id, venue_id, provider, started_at, status, items_changed, correlation_id)
			VALUES ($1, $2, $3, $4, $5, 0, $6)
		`, run.ID, run.VenueID, run.Provider, run.StartedAt, run.Status, run.CorrelationID)
		return err
	})
	if err != nil {
		return model.SyncRun{}, fmt.Errorf("insert sync run: %w", err)
	}
	return run, nil
}

// FinishRun marks a sync run as finished, recording outcome.
func (s *Store) FinishRun(ctx context.Context, runID string, status model.SyncStatus, itemsChanged int, syncErr error) error {
	var errText *string
	if syncErr != nil {
		msg := syncErr.Error()
		errText = &msg
	}
	err := s.tracer.WithSpan(ctx, "db.commit sync_runs", func(ctx context.Context) error {
		_, err := s.pool.Exec(ctx, `
			UPDATE sync_runs
			SET finished_at = $2, status = $3, items_changed = $4, error = $5
			WHERE id = $1
		`, runID, time.Now().UTC(), status, itemsChanged, errText)
		return err
	})
	if err != nil {
		return fmt.Errorf("update sync run: %w", err)
	}
	return nil
}

// RecentRuns returns the most recent sync runs, optionally filtered by venue.
func (s *Store) RecentRuns(ctx context.Context, venueID string, limit int) ([]model.SyncRun, error) {
	if limit <= 0 {
		limit = 50
	}

	query := `
		SELECT id, venue_id, provider, started_at, finished_at, items_changed, status, error, correlation_id
		FROM sync_runs
		WHERE ($1 = '' OR venue_id = $1)
		ORDER BY started_at DESC
		LIMIT $2
	`
	pgRows, err := s.pool.Query(ctx, query, venueID, limit)
	if err != nil {
		return nil, fmt.Errorf("query sync runs: %w", err)
	}
	defer pgRows.Close()

	var runs []model.SyncRun
	for pgRows.Next() {
		var run model.SyncRun
		if err := pgRows.Scan(&run.ID, &run.VenueID, &run.Provider, &run.StartedAt, &run.FinishedAt, &run.ItemsChanged, &run.Status, &run.Error, &run.CorrelationID); err != nil {
			return nil, fmt.Errorf("scan sync run: %w", err)
		}
		runs = append(runs, run)
	}
	if err := pgRows.Err(); err != nil {
		return nil, fmt.Errorf("iterate sync runs: %w", err)
	}
	return runs, nil
}
