// Package worker polls all configured venues concurrently, bounded by a
// configurable concurrency limit, and pushes results to Kafka + Postgres.
package worker

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"github.com/clearpath/pos-ingest/internal/config"
	"github.com/clearpath/pos-ingest/internal/kafka"
	"github.com/clearpath/pos-ingest/internal/model"
	"github.com/clearpath/pos-ingest/internal/provider"
	"github.com/clearpath/pos-ingest/internal/retry"
	"github.com/clearpath/pos-ingest/internal/store"
	"github.com/clearpath/pos-ingest/internal/tracing"
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

	// inFlight tracks venue-poll goroutines launched by pollAll so Wait can block shutdown
	// until they've actually finished, instead of the process exiting mid-poll and leaving a
	// sync_runs row stuck at status=running forever.
	inFlight sync.WaitGroup

	// chaosLatencyMs is injected artificial delay (milliseconds) applied before each venue
	// poll, when > 0. Set via POST /chaos/latency, guarded by CHAOS_ENABLED. See
	// docs/adr/0005-observability-ui.md.
	chaosLatencyMs atomic.Int64

	logger *slog.Logger
}

// SetChaosLatencyMs sets (or clears, with 0) the artificial delay applied before each venue poll.
func (p *Pool) SetChaosLatencyMs(ms int64) {
	p.chaosLatencyMs.Store(ms)
}

// ChaosLatencyMs returns the currently injected delay, in milliseconds.
func (p *Pool) ChaosLatencyMs() int64 {
	return p.chaosLatencyMs.Load()
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
		p.inFlight.Add(1)
		go func() {
			defer p.inFlight.Done()
			defer func() { <-p.sem }()
			_, _ = p.pollVenue(ctx, venue)
		}()
	}
}

// Wait blocks until every in-flight venue-poll goroutine started by pollAll has finished, or ctx
// is done, whichever comes first — called during shutdown so a SIGTERM doesn't abandon a poll
// mid-flight with its sync_runs row stuck at status=running.
func (p *Pool) Wait(ctx context.Context) {
	done := make(chan struct{})
	go func() {
		p.inFlight.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-ctx.Done():
	}
}

// PollVenueNow triggers an out-of-band poll of a single venue, bounded by the same
// concurrency semaphore as the ticker-driven polls, and returns the finished run —
// used by the operator-triggered "retry" endpoint (POST /sync-runs/{id}/retry).
func (p *Pool) PollVenueNow(ctx context.Context, venueID string) (model.SyncRun, error) {
	var venue config.VenueConfig
	found := false
	for _, v := range p.venues {
		if v.VenueID == venueID {
			venue = v
			found = true
			break
		}
	}
	if !found {
		return model.SyncRun{}, fmt.Errorf("venue %q is not configured", venueID)
	}

	select {
	case p.sem <- struct{}{}:
	case <-ctx.Done():
		return model.SyncRun{}, ctx.Err()
	}
	defer func() { <-p.sem }()

	return p.pollVenue(ctx, venue)
}

func (p *Pool) pollVenue(ctx context.Context, venue config.VenueConfig) (model.SyncRun, error) {
	if ms := p.chaosLatencyMs.Load(); ms > 0 {
		select {
		case <-time.After(time.Duration(ms) * time.Millisecond):
		case <-ctx.Done():
			return model.SyncRun{}, ctx.Err()
		}
	}

	prov, ok := p.providers[venue.Provider]
	if !ok {
		p.logger.Error("unknown provider for venue", "venue", venue.VenueID, "provider", venue.Provider)
		return model.SyncRun{}, fmt.Errorf("unknown provider %q for venue %q", venue.Provider, venue.VenueID)
	}

	correlationID := newCorrelationID()
	ctx = tracing.WithCorrelationID(ctx, correlationID)
	logger := p.logger.With("venueId", venue.VenueID, "provider", venue.Provider, "correlationId", correlationID)

	run, err := p.store.StartRun(ctx, venue.VenueID, venue.Provider, correlationID)
	if err != nil {
		logger.Error("failed to record sync run start", "error", err)
		return model.SyncRun{}, err
	}

	fetchAttempts := 0
	items, err := retry.Do(ctx, retry.Config{
		MaxAttempts: p.maxRetries,
		BaseDelay:   p.retryBaseDelay,
		MaxDelay:    p.retryMaxDelay,
		Retryable:   provider.Retryable,
	}, func(ctx context.Context) ([]model.NormalizedItem, error) {
		fetchAttempts++
		return prov.FetchVenueMenu(ctx, venue.VenueID)
	})

	// From here on, every remaining step is finalizing a run that's already been marked
	// status=running — including during shutdown, when ctx may already be canceled (main.go
	// cancels ctx before calling Pool.Wait). Using ctx for these writes would mean a poll that was
	// in flight at shutdown always fails to finalize, leaving its sync_runs row stuck at
	// status=running forever — exactly what Pool.Wait exists to prevent. finalizeCtx is
	// deliberately decoupled from ctx's cancellation (bounded by its own short timeout instead) so
	// these writes still get a fair chance to complete.
	finalizeCtx, finalizeCancel := finalizeContext(ctx)
	defer finalizeCancel()

	if err != nil {
		logger.Warn("sync run failed after retries", "error", err)
		return p.handleFailure(finalizeCtx, run, venue, correlationID, fetchAttempts, err, logger), nil
	}

	envelope := model.SyncEnvelope{
		VenueID:       venue.VenueID,
		Provider:      venue.Provider,
		CorrelationID: correlationID,
		SyncedAt:      time.Now().UTC(),
		Items:         model.ItemsToSynced(items),
	}
	finishedAt := time.Now().UTC()
	if err := p.producer.PublishSync(finalizeCtx, envelope, fetchAttempts); err != nil {
		logger.Error("failed to publish pos.sync", "error", err)
		if fErr := p.store.FinishRun(finalizeCtx, run.ID, model.SyncStatusFailed, 0, err); fErr != nil {
			logger.Error("failed to record sync run failure", "error", fErr)
		}
		errText := err.Error()
		run.Status = model.SyncStatusFailed
		run.FinishedAt = &finishedAt
		run.Error = &errText
		return run, nil
	}

	if err := p.store.FinishRun(finalizeCtx, run.ID, model.SyncStatusSuccess, len(items), nil); err != nil {
		logger.Error("failed to record sync run success", "error", err)
	}
	logger.Info("sync run succeeded", "itemsChanged", len(items))
	run.Status = model.SyncStatusSuccess
	run.FinishedAt = &finishedAt
	run.ItemsChanged = len(items)
	return run, nil
}

// finalizeContext derives a context for the final sync_runs write that survives ctx's own
// cancellation (e.g. shutdown) but is still bounded, so it can't hang forever if the store is
// genuinely unreachable.
func finalizeContext(ctx context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
}

func (p *Pool) handleFailure(ctx context.Context, run model.SyncRun, venue config.VenueConfig, correlationID string, attempts int, syncErr error, logger *slog.Logger) model.SyncRun {
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
	finishedAt := time.Now().UTC()
	errText := syncErr.Error()
	run.Status = model.SyncStatusFailed
	run.FinishedAt = &finishedAt
	run.Error = &errText
	return run
}

func newCorrelationID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}
