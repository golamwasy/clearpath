package provider

import (
	"errors"
	"testing"
)

func TestNormalizeFlat(t *testing.T) {
	tests := []struct {
		name      string
		body      string
		wantItems int
		wantErr   error
	}{
		{
			name:      "valid payload",
			body:      `[{"id":4471,"name":"Cheeseburger","price":"12.99","available":1}]`,
			wantItems: 1,
		},
		{
			name:      "decimal price with more than 2 decimal places truncates",
			body:      `[{"id":4471,"name":"Cheeseburger","price":"12.999","available":1}]`,
			wantItems: 1,
		},
		{
			name:      "price missing decimal point treated as whole dollars",
			body:      `[{"id":4471,"name":"Water","price":"3","available":1}]`,
			wantItems: 1,
		},
		{
			name:    "non-numeric price",
			body:    `[{"id":4471,"name":"Bad","price":"free","available":1}]`,
			wantErr: ErrMalformedPayload,
		},
		{
			name:    "available as unexpected value",
			body:    `[{"id":4471,"name":"Bad","price":"1.00","available":2}]`,
			wantErr: ErrMalformedPayload,
		},
		{
			name:      "empty array",
			body:      `[]`,
			wantItems: 0,
		},
		{
			name:    "truncated json",
			body:    `[{"id": 4471, "name": "Cheeseburger", "price":`,
			wantErr: ErrMalformedPayload,
		},
		{
			name:    "not an array",
			body:    `{"id":4471}`,
			wantErr: ErrMalformedPayload,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			items, err := normalizeFlat("v1", "USD", []byte(tt.body))
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

func TestNormalizeFlat_PriceConversion(t *testing.T) {
	cases := []struct {
		price string
		want  int64
	}{
		{"12.99", 1299},
		{"8.9", 890},
		{"3", 300},
		{"12.999", 1299},
		{"0.05", 5},
	}
	for _, c := range cases {
		got, err := decimalStringToCents(c.price)
		if err != nil {
			t.Fatalf("decimalStringToCents(%q) unexpected error: %v", c.price, err)
		}
		if got != c.want {
			t.Errorf("decimalStringToCents(%q) = %d, want %d", c.price, got, c.want)
		}
	}
}
