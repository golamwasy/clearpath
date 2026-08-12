// flat-pos is a mock POS provider that returns a flat JSON array, decimal
// string prices, and integer item IDs — deliberately shaped differently
// from nested-pos and from pos-ingest's internal model.
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

type flatItem struct {
	ID        int    `json:"id"`
	Name      string `json:"name"`
	Price     string `json:"price"`
	Available int    `json:"available"`
}

var requestCount atomic.Int64

func sampleItems() []flatItem {
	return []flatItem{
		{ID: 4471, Name: "Cheeseburger", Price: "12.99", Available: 1},
		{ID: 4472, Name: "Veggie Wrap", Price: "8.9", Available: 0},
		{ID: 4473, Name: "Sparkling Water", Price: "3.5", Available: 1},
	}
}

func main() {
	failEveryN, _ := strconv.Atoi(os.Getenv("FAIL_EVERY_N"))
	delayMs, _ := strconv.Atoi(os.Getenv("DELAY_MS"))

	mux := http.NewServeMux()
	mux.HandleFunc("/menu", func(w http.ResponseWriter, r *http.Request) {
		venueID := r.URL.Query().Get("venue")
		if venueID == "" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}

		if delayMs > 0 {
			time.Sleep(time.Duration(delayMs) * time.Millisecond)
		}

		n := requestCount.Add(1)
		if failEveryN > 0 {
			switch n % int64(failEveryN) {
			case 0:
				w.WriteHeader(http.StatusServiceUnavailable)
				_, _ = w.Write([]byte(`{"error":"rate limited"}`))
				return
			case 1:
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`[{"id": 4471, "name": "Cheeseburger", "price":`))
				return
			}
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(sampleItems())
	})
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "9002"
	}
	log.Printf("flat-pos mock listening on :%s (FAIL_EVERY_N=%d DELAY_MS=%d)", port, failEveryN, delayMs)
	log.Fatal(http.ListenAndServe(":"+port, mux))
}
