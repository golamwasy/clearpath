// Package worker polls all configured venues concurrently, bounded by a
// configurable concurrency limit, and pushes results to Kafka + Postgres.
package worker

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"time"

	"github.com/clearpath/pos-ingest/internal/config"
	"github.com/clearpath/pos-ingest/internal/kafka"
	"github.com/clearpath/pos-ingest/internal/model"
	"github.com/clearpath/pos-ingest/internal/provider"
	"github.com/clearpath/pos-ingest/internal/retry"
	"github.com/clearpath/pos-ingest/internal/store"
)

type Pool struct {
	venues    []config.VenueConfig
	providers map[string]provider.Provider

	store    *store.Store
	producer *kafka.Producer

	maxRetries     int
	retryBaseDelay time.Duration
	retryMaxDelay  time.Duration

	sem chan struct{}

	logger *slog.Logger
}

func NewPool(
	venues []config.VenueConfig,
	providers map[string]provider.Provider,
	st *store.Store,
	producer *kafka.Producer,
	maxConcurrency, maxRetries int,
	retryBaseDelay, retryMaxDelay time.Duration,
	logger *slog.Logger,
) *Pool {
	if maxConcurrency <= 0 {
		maxConcurrency = 1
	}
	return &Pool{
		venues:         venues,
		providers:      providers,
		store:          st,
		producer:       producer,
		maxRetries:     maxRetries,
		retryBaseDelay: retryBaseDelay,
		retryMaxDelay:  retryMaxDelay,
		sem:            make(chan struct{}, maxConcurrency),
		logger:         logger,
	}
}

// Run polls all configured venues once per pollInterval, forever, until ctx
// is cancelled. Each tick, every venue is polled concurrently, bounded by
// the pool's concurrency semaphore — a slow provider doesn't block polls of
// other venues beyond the semaphore's capacity.
func (p *Pool) Run(ctx context.Context, pollInterval time.Duration) {
	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()

	p.pollAll(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			p.pollAll(ctx)
		}
	}
}

func (p *Pool) pollAll(ctx context.Context) {
	for _, venue := range p.venues {
		venue := venue
		select {
		case p.sem <- struct{}{}:
		case <-ctx.Done():
			return
		}
		go func() {
			defer func() { <-p.sem }()
			p.pollVenue(ctx, venue)
		}()
	}
}

func (p *Pool) pollVenue(ctx context.Context, venue config.VenueConfig) {
	prov, ok := p.providers[venue.Provider]
	if !ok {
		p.logger.Error("unknown provider for venue", "venue", venue.VenueID, "provider", venue.Provider)
		return
	}

	correlationID := newCorrelationID()
	logger := p.logger.With("venueId", venue.VenueID, "provider", venue.Provider, "correlationId", correlationID)

	run, err := p.store.StartRun(ctx, venue.VenueID, venue.Provider, correlationID)
	if err != nil {
		logger.Error("failed to record sync run start", "error", err)
		return
	}

	items, err := retry.Do(ctx, retry.Config{
		MaxAttempts: p.maxRetries,
		BaseDelay:   p.retryBaseDelay,
		MaxDelay:    p.retryMaxDelay,
		Retryable:   provider.Retryable,
	}, func(ctx context.Context) ([]model.NormalizedItem, error) {
		return prov.FetchVenueMenu(ctx, venue.VenueID)
	})

	if err != nil {
		logger.Warn("sync run failed after retries", "error", err)
		p.handleFailure(ctx, run, venue, correlationID, err, logger)
		return
	}

	envelope := model.SyncEnvelope{
		VenueID:       venue.VenueID,
		Provider:      venue.Provider,
		CorrelationID: correlationID,
		SyncedAt:      time.Now().UTC(),
		Items:         model.ItemsToSynced(items),
	}
	if err := p.producer.PublishSync(ctx, envelope); err != nil {
		logger.Error("failed to publish pos.sync", "error", err)
		if fErr := p.store.FinishRun(ctx, run.ID, model.SyncStatusFailed, 0, err); fErr != nil {
			logger.Error("failed to record sync run failure", "error", fErr)
		}
		return
	}

	if err := p.store.FinishRun(ctx, run.ID, model.SyncStatusSuccess, len(items), nil); err != nil {
		logger.Error("failed to record sync run success", "error", err)
	}
	logger.Info("sync run succeeded", "itemsChanged", len(items))
}

func (p *Pool) handleFailure(ctx context.Context, run model.SyncRun, venue config.VenueConfig, correlationID string, syncErr error, logger *slog.Logger) {
	attempts := p.maxRetries
	dlqEnvelope := model.DLQEnvelope{
		VenueID:       venue.VenueID,
		Provider:      venue.Provider,
		CorrelationID: correlationID,
		FailedAt:      time.Now().UTC(),
		Attempts:      attempts,
		Error:         syncErr.Error(),
	}
	if err := p.producer.PublishDLQ(ctx, dlqEnvelope); err != nil {
		logger.Error("failed to publish to DLQ", "error", err)
	}
	if err := p.store.FinishRun(ctx, run.ID, model.SyncStatusFailed, 0, syncErr); err != nil {
		logger.Error("failed to record sync run failure", "error", err)
	}
}

func newCorrelationID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}
