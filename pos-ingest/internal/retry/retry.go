// Package retry provides exponential backoff with full jitter for
// retryable operations.
package retry

import (
	"context"
	"fmt"
	"math/rand"
	"time"
)

// ErrExhausted wraps the last error after all attempts are used up.
type ErrExhausted struct {
	Attempts int
	Last     error
}

func (e *ErrExhausted) Error() string {
	return fmt.Sprintf("retry: exhausted %d attempts: %v", e.Attempts, e.Last)
}

func (e *ErrExhausted) Unwrap() error { return e.Last }

// Config controls backoff behavior.
type Config struct {
	MaxAttempts int
	BaseDelay   time.Duration
	MaxDelay    time.Duration
	// Retryable decides whether an error returned by fn should be retried.
	// If nil, all errors are retried.
	Retryable func(error) bool
	// Sleep is injectable for tests; defaults to a context-aware sleep.
	Sleep func(ctx context.Context, d time.Duration) error
	// Rand is injectable for deterministic jitter in tests; defaults to
	// math/rand's package-level source.
	Rand func() float64
}

func defaultSleep(ctx context.Context, d time.Duration) error {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-timer.C:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// Do runs fn, retrying on retryable errors with exponential backoff and
// full jitter (sleep = rand(0, min(maxDelay, base*2^attempt))) between
// attempts. Returns the result of the first successful call, or
// *ErrExhausted wrapping the last error once MaxAttempts is reached.
// A non-retryable error is returned immediately without further attempts.
func Do[T any](ctx context.Context, cfg Config, fn func(ctx context.Context) (T, error)) (T, error) {
	sleep := cfg.Sleep
	if sleep == nil {
		sleep = defaultSleep
	}
	randFn := cfg.Rand
	if randFn == nil {
		randFn = rand.Float64
	}
	retryable := cfg.Retryable
	if retryable == nil {
		retryable = func(error) bool { return true }
	}

	var lastErr error
	for attempt := 0; attempt < cfg.MaxAttempts; attempt++ {
		result, err := fn(ctx)
		if err == nil {
			return result, nil
		}
		lastErr = err

		if !retryable(err) {
			var zero T
			return zero, err
		}
		if attempt == cfg.MaxAttempts-1 {
			break
		}

		delay := cfg.BaseDelay * time.Duration(1<<uint(attempt))
		if cfg.MaxDelay > 0 && delay > cfg.MaxDelay {
			delay = cfg.MaxDelay
		}
		jittered := time.Duration(randFn() * float64(delay))
		if err := sleep(ctx, jittered); err != nil {
			var zero T
			return zero, err
		}
	}

	var zero T
	return zero, &ErrExhausted{Attempts: cfg.MaxAttempts, Last: lastErr}
}
