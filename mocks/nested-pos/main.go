// nested-pos is a mock POS provider that returns nested JSON, prices in
// cents, and string item IDs — deliberately shaped differently from
// flat-pos and from pos-ingest's internal model.
package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strconv"
	"sync/atomic"
	"time"
)

type pricing struct {
	AmountCents int    `json:"amountCents"`
	Currency    string `json:"currency"`
}

type item struct {
	ID      string  `json:"id"`
	Title   string  `json:"title"`
	Pricing pricing `json:"pricing"`
	InStock bool    `json:"inStock"`
}

type itemWrapper struct {
	Item item `json:"item"`
}

type venue struct {
	ID    string        `json:"id"`
	Items []itemWrapper `json:"items"`
}

type menuResponse struct {
	Venue venue `json:"venue"`
}

var requestCount atomic.Int64

func menu(items []itemWrapper) menuResponse {
	return menuResponse{Venue: venue{Items: items}}
}

func sampleItems(venueID string) []itemWrapper {
	return []itemWrapper{
		{Item: item{ID: "itm-001", Title: "Cheeseburger", Pricing: pricing{AmountCents: 1299, Currency: "USD"}, InStock: true}},
		{Item: item{ID: "itm-002", Title: "Veggie Wrap", Pricing: pricing{AmountCents: 899, Currency: "USD"}, InStock: false}},
		{Item: item{ID: "itm-003", Title: "Sparkling Water", Pricing: pricing{AmountCents: 349, Currency: "USD"}, InStock: true}},
	}
}

func main() {
	failEveryN, _ := strconv.Atoi(os.Getenv("FAIL_EVERY_N"))
	delayMs, _ := strconv.Atoi(os.Getenv("DELAY_MS"))

	mux := http.NewServeMux()
	mux.HandleFunc("/venues/", func(w http.ResponseWriter, r *http.Request) {
		venueID := r.URL.Path[len("/venues/"):]
		if len(venueID) > 5 && venueID[len(venueID)-5:] == "/menu" {
			venueID = venueID[:len(venueID)-5]
		}

		if delayMs > 0 {
			time.Sleep(time.Duration(delayMs) * time.Millisecond)
		}

		n := requestCount.Add(1)
		if failEveryN > 0 {
			switch n % int64(failEveryN) {
			case 0:
				w.WriteHeader(http.StatusInternalServerError)
				_, _ = w.Write([]byte(`{"error":"upstream unavailable"}`))
				return
			case 1:
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"venue": {"id": "` + venueID + `", "items": [{"item": {"id": "itm-001"`))
				return
			}
		}

		resp := menu(sampleItems(venueID))
		resp.Venue.ID = venueID
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	})
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "9001"
	}
	log.Printf("nested-pos mock listening on :%s (FAIL_EVERY_N=%d DELAY_MS=%d)", port, failEveryN, delayMs)
	log.Fatal(http.ListenAndServe(":"+port, mux))
}
