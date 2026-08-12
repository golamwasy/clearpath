// Package ratelimit provides per-provider rate limiting for outbound POS
// requests.
package ratelimit

import (
	"context"

	"golang.org/x/time/rate"
)

// Limiter wraps golang.org/x/time/rate for one provider, shared across all
// venues polled against that provider so the limit applies provider-wide
// rather than per venue.
type Limiter struct {
	limiter *rate.Limiter
}

// New creates a limiter allowing rps requests per second with the given
// burst. rps <= 0 means unlimited (useful for tests/mocks with no rate cap).
func New(rps float64, burst int) *Limiter {
	if rps <= 0 {
		return &Limiter{limiter: rate.NewLimiter(rate.Inf, 0)}
	}
	return &Limiter{limiter: rate.NewLimiter(rate.Limit(rps), burst)}
}

// Wait blocks until a request may proceed or ctx is done.
func (l *Limiter) Wait(ctx context.Context) error {
	return l.limiter.Wait(ctx)
}
