// Package provider adapts each POS provider's wire format into the
// internal model.NormalizedItem schema.
package provider

import (
	"context"
	"errors"

	"github.com/clearpath/pos-ingest/internal/model"
)

// Provider fetches and normalizes one venue's menu from a POS system.
type Provider interface {
	Name() string
	FetchVenueMenu(ctx context.Context, venueID string) ([]model.NormalizedItem, error)
}

// ErrMalformedPayload indicates the provider returned a response pos-ingest
// could not parse into its expected wire shape. Distinguished from network/
// 5xx errors so the retry layer can fail fast instead of retrying a payload
// that will never parse.
var ErrMalformedPayload = errors.New("malformed provider payload")

// ErrUpstreamUnavailable indicates a network error or 5xx response —
// retryable.
var ErrUpstreamUnavailable = errors.New("upstream provider unavailable")

// Retryable reports whether err represents a condition worth retrying.
func Retryable(err error) bool {
	return errors.Is(err, ErrUpstreamUnavailable)
}
