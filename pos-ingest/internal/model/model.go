// Package model holds the internal normalized schema that all POS provider
// adapters convert into, and the sync-run history record.
package model

import "time"

// NormalizedItem is the internal representation every provider adapter
// converts its wire format into. Neither mock provider's payload matches it.
type NormalizedItem struct {
	ProviderItemID string
	VenueID        string
	Name           string
	PriceCents     int64
	Currency       string
	Available      bool
}

// SyncStatus is the lifecycle state of a sync run.
type SyncStatus string

const (
	SyncStatusRunning SyncStatus = "running"
	SyncStatusSuccess SyncStatus = "success"
	SyncStatusFailed  SyncStatus = "failed"
)

// SyncRun is a single poll of one venue against one provider, persisted to
// Postgres for /sync-runs history.
type SyncRun struct {
	ID            string
	VenueID       string
	Provider      string
	StartedAt     time.Time
	FinishedAt    *time.Time
	ItemsChanged  int
	Status        SyncStatus
	Error         *string
	CorrelationID string
}

// SyncEnvelope is the message body published to pos.sync: one message per
// sync run rather than one per item, so downstream consumers see a run's
// items as a unit.
type SyncEnvelope struct {
	VenueID       string       `json:"venueId"`
	Provider      string       `json:"provider"`
	CorrelationID string       `json:"correlationId"`
	SyncedAt      time.Time    `json:"syncedAt"`
	Items         []SyncedItem `json:"items"`
}

// SyncedItem is the wire representation of a NormalizedItem inside a
// SyncEnvelope.
type SyncedItem struct {
	ProviderItemID string `json:"providerItemId"`
	Name           string `json:"name"`
	PriceCents     int64  `json:"priceCents"`
	Currency       string `json:"currency"`
	Available      bool   `json:"available"`
}

// DLQEnvelope is published to pos.sync.dlq when a venue poll exhausts its
// retries. There is usually no valid normalized payload to send — the whole
// point is that normalization/fetch failed — so it carries diagnostic
// context instead.
type DLQEnvelope struct {
	VenueID       string    `json:"venueId"`
	Provider      string    `json:"provider"`
	CorrelationID string    `json:"correlationId"`
	FailedAt      time.Time `json:"failedAt"`
	Attempts      int       `json:"attempts"`
	Error         string    `json:"error"`
}

func ItemsToSynced(items []NormalizedItem) []SyncedItem {
	out := make([]SyncedItem, 0, len(items))
	for _, it := range items {
		out = append(out, SyncedItem{
			ProviderItemID: it.ProviderItemID,
			Name:           it.Name,
			PriceCents:     it.PriceCents,
			Currency:       it.Currency,
			Available:      it.Available,
		})
	}
	return out
}
