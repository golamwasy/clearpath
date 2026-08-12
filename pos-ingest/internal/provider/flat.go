package provider

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/clearpath/pos-ingest/internal/model"
	"github.com/clearpath/pos-ingest/internal/ratelimit"
)

// flatItem mirrors the flat-pos mock's wire shape: a flat array, integer
// item IDs, and prices as decimal strings.
type flatItem struct {
	ID        json.Number `json:"id"`
	Name      string      `json:"name"`
	Price     string      `json:"price"`
	Available int         `json:"available"`
}

// FlatProvider adapts the "flat array, decimal string prices, int IDs" POS
// shape.
type FlatProvider struct {
	name     string
	baseURL  string
	currency string
	client   *http.Client
	limiter  *ratelimit.Limiter
}

func NewFlatProvider(name, baseURL, currency string, client *http.Client, limiter *ratelimit.Limiter) *FlatProvider {
	return &FlatProvider{name: name, baseURL: baseURL, currency: currency, client: client, limiter: limiter}
}

func (p *FlatProvider) Name() string { return p.name }

func (p *FlatProvider) FetchVenueMenu(ctx context.Context, venueID string) ([]model.NormalizedItem, error) {
	if err := p.limiter.Wait(ctx); err != nil {
		return nil, fmt.Errorf("%w: rate limiter wait: %v", ErrUpstreamUnavailable, err)
	}

	url := fmt.Sprintf("%s/menu?venue=%s", p.baseURL, venueID)
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

	currency := p.currency
	if currency == "" {
		currency = "USD"
	}
	return normalizeFlat(venueID, currency, body)
}

func normalizeFlat(venueID, currency string, body []byte) ([]model.NormalizedItem, error) {
	var raw []flatItem
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.UseNumber()
	if err := dec.Decode(&raw); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrMalformedPayload, err)
	}

	items := make([]model.NormalizedItem, 0, len(raw))
	for _, it := range raw {
		if it.ID.String() == "" {
			return nil, fmt.Errorf("%w: item missing id", ErrMalformedPayload)
		}
		cents, err := decimalStringToCents(it.Price)
		if err != nil {
			return nil, fmt.Errorf("%w: item %s has invalid price %q: %v", ErrMalformedPayload, it.ID, it.Price, err)
		}
		if it.Available != 0 && it.Available != 1 {
			return nil, fmt.Errorf("%w: item %s has unexpected available value %d", ErrMalformedPayload, it.ID, it.Available)
		}
		items = append(items, model.NormalizedItem{
			ProviderItemID: it.ID.String(),
			VenueID:        venueID,
			Name:           it.Name,
			PriceCents:     cents,
			Currency:       currency,
			Available:      it.Available == 1,
		})
	}
	return items, nil
}

// decimalStringToCents parses a decimal price string ("12.99", "8.9", "3")
// into integer cents without going through float64, to avoid binary
// floating-point rounding on money.
func decimalStringToCents(price string) (int64, error) {
	price = strings.TrimSpace(price)
	if price == "" {
		return 0, fmt.Errorf("empty price")
	}

	negative := false
	if strings.HasPrefix(price, "-") {
		negative = true
		price = price[1:]
	}

	whole, frac, hasFrac := strings.Cut(price, ".")
	if whole == "" {
		return 0, fmt.Errorf("missing whole part")
	}
	if hasFrac {
		switch len(frac) {
		case 0:
			frac = "00"
		case 1:
			frac = frac + "0"
		case 2:
			// exact
		default:
			frac = frac[:2]
		}
	} else {
		frac = "00"
	}

	wholeN, err := strconv.ParseInt(whole, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid whole part %q: %w", whole, err)
	}
	fracN, err := strconv.ParseInt(frac, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid fractional part %q: %w", frac, err)
	}

	cents := wholeN*100 + fracN
	if negative {
		cents = -cents
	}
	return cents, nil
}
