package provider

import (
	"errors"
	"testing"
)

func TestNormalizeNested(t *testing.T) {
	tests := []struct {
		name      string
		body      string
		wantItems int
		wantErr   error
	}{
		{
			name: "valid multi-item payload",
			body: `{"venue":{"id":"v1","items":[
				{"item":{"id":"itm-001","title":"Cheeseburger","pricing":{"amountCents":1299,"currency":"USD"},"inStock":true}},
				{"item":{"id":"itm-002","title":"Veggie Wrap","pricing":{"amountCents":899,"currency":"USD"},"inStock":false}}
			]}}`,
			wantItems: 2,
		},
		{
			name:      "empty item list",
			body:      `{"venue":{"id":"v1","items":[]}}`,
			wantItems: 0,
		},
		{
			name: "missing pricing field",
			body: `{"venue":{"id":"v1","items":[
				{"item":{"id":"itm-001","title":"No Price","inStock":true}}
			]}}`,
			wantErr: ErrMalformedPayload,
		},
		{
			name: "non-numeric amountCents",
			body: `{"venue":{"id":"v1","items":[
				{"item":{"id":"itm-001","title":"Bad Price","pricing":{"amountCents":"not-a-number","currency":"USD"},"inStock":true}}
			]}}`,
			wantErr: ErrMalformedPayload,
		},
		{
			name: "item missing id",
			body: `{"venue":{"id":"v1","items":[
				{"item":{"title":"No Id","pricing":{"amountCents":100,"currency":"USD"},"inStock":true}}
			]}}`,
			wantErr: ErrMalformedPayload,
		},
		{
			name:    "truncated json",
			body:    `{"venue": {"id": "v1", "items": [{"item": {"id": "itm-001"`,
			wantErr: ErrMalformedPayload,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			items, err := normalizeNested("v1", []byte(tt.body))
			if tt.wantErr != nil {
				if !errors.Is(err, tt.wantErr) {
					t.Fatalf("expected error %v, got %v", tt.wantErr, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if len(items) != tt.wantItems {
				t.Fatalf("expected %d items, got %d", tt.wantItems, len(items))
			}
		})
	}
}

func TestNormalizeNested_PriceConversion(t *testing.T) {
	body := `{"venue":{"id":"v1","items":[
		{"item":{"id":"itm-001","title":"Cheeseburger","pricing":{"amountCents":1299,"currency":"USD"},"inStock":true}}
	]}}`
	items, err := normalizeNested("v1", []byte(body))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(items))
	}
	got := items[0]
	if got.PriceCents != 1299 || got.ProviderItemID != "itm-001" || got.VenueID != "v1" || !got.Available {
		t.Fatalf("unexpected normalized item: %+v", got)
	}
}
