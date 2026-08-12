package provider

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/clearpath/pos-ingest/internal/model"
	"github.com/clearpath/pos-ingest/internal/ratelimit"
)

// nestedPricing/nestedItem/... mirror the nested-pos mock's wire shape:
// nested JSON, prices in integer cents, string item IDs.
type nestedPricing struct {
	AmountCents json.Number `json:"amountCents"`
	Currency    string      `json:"currency"`
}

type nestedItem struct {
	ID      string        `json:"id"`
	Title   string        `json:"title"`
	Pricing nestedPricing `json:"pricing"`
	InStock bool          `json:"inStock"`
}

type nestedItemWrapper struct {
	Item nestedItem `json:"item"`
}

type nestedVenue struct {
	ID    string              `json:"id"`
	Items []nestedItemWrapper `json:"items"`
}

type nestedMenuResponse struct {
	Venue nestedVenue `json:"venue"`
}

// NestedProvider adapts the "nested JSON, cents, string IDs" POS shape.
type NestedProvider struct {
	name    string
	baseURL string
	client  *http.Client
	limiter *ratelimit.Limiter
}

func NewNestedProvider(name, baseURL string, client *http.Client, limiter *ratelimit.Limiter) *NestedProvider {
	return &NestedProvider{name: name, baseURL: baseURL, client: client, limiter: limiter}
}

func (p *NestedProvider) Name() string { return p.name }

func (p *NestedProvider) FetchVenueMenu(ctx context.Context, venueID string) ([]model.NormalizedItem, error) {
	if err := p.limiter.Wait(ctx); err != nil {
		return nil, fmt.Errorf("%w: rate limiter wait: %v", ErrUpstreamUnavailable, err)
	}

	url := fmt.Sprintf("%s/venues/%s/menu", p.baseURL, venueID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("%w: build request: %v", ErrUpstreamUnavailable, err)
	}

	resp, err := p.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("%w: read body: %v", ErrUpstreamUnavailable, err)
	}

	if resp.StatusCode >= 500 {
		return nil, fmt.Errorf("%w: status %d", ErrUpstreamUnavailable, resp.StatusCode)
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("%w: status %d", ErrMalformedPayload, resp.StatusCode)
	}

	return normalizeNested(venueID, body)
}

func normalizeNested(venueID string, body []byte) ([]model.NormalizedItem, error) {
	var raw nestedMenuResponse
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.UseNumber()
	if err := dec.Decode(&raw); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrMalformedPayload, err)
	}

	items := make([]model.NormalizedItem, 0, len(raw.Venue.Items))
	for _, w := range raw.Venue.Items {
		it := w.Item
		if it.ID == "" {
			return nil, fmt.Errorf("%w: item missing id", ErrMalformedPayload)
		}
		cents, err := it.Pricing.AmountCents.Int64()
		if err != nil {
			return nil, fmt.Errorf("%w: item %s has non-numeric amountCents: %v", ErrMalformedPayload, it.ID, err)
		}
		currency := it.Pricing.Currency
		if currency == "" {
			currency = "USD"
		}
		items = append(items, model.NormalizedItem{
			ProviderItemID: it.ID,
			VenueID:        venueID,
			Name:           it.Title,
			PriceCents:     cents,
			Currency:       currency,
			Available:      it.InStock,
		})
	}
	return items, nil
}
