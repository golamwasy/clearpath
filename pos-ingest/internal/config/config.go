// Package config loads pos-ingest configuration from environment variables
// and a venues JSON file.
package config

import (
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// VenueConfig is one venue to poll, and which provider serves it.
type VenueConfig struct {
	VenueID  string `json:"venueId"`
	Provider string `json:"provider"` // must match a key in Config.Providers
}

// ProviderConfig describes one POS provider's connection and rate limit.
type ProviderConfig struct {
	Name      string  `json:"name"`
	Kind      string  `json:"kind"` // "nested" | "flat"
	BaseURL   string  `json:"baseUrl"`
	Currency  string  `json:"currency"`
	RateRPS   float64 `json:"rateRps"`
	RateBurst int     `json:"rateBurst"`
}

type VenuesFile struct {
	Providers []ProviderConfig `json:"providers"`
	Venues    []VenueConfig    `json:"venues"`
}

type Config struct {
	HTTPPort string

	DBURL string

	KafkaBrokers []string
	SyncTopic    string
	DLQTopic     string

	MaxConcurrency int
	PollInterval   time.Duration
	MaxRetries     int
	RetryBaseDelay time.Duration
	RetryMaxDelay  time.Duration
	HTTPTimeout    time.Duration

	Providers []ProviderConfig
	Venues    []VenueConfig
}

func Load() (Config, error) {
	cfg := Config{
		HTTPPort:       getEnv("POS_HTTP_PORT", "8083"),
		DBURL:          getEnv("POS_DB_URL", "postgres://pos_ingest:pos_ingest@localhost:5432/pos_ingest"),
		KafkaBrokers:   strings.Split(getEnv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092"), ","),
		SyncTopic:      getEnv("POS_SYNC_TOPIC", "pos.sync"),
		DLQTopic:       getEnv("POS_SYNC_DLQ_TOPIC", "pos.sync.dlq"),
		MaxConcurrency: getEnvInt("POS_MAX_CONCURRENCY", 5),
		PollInterval:   getEnvDuration("POS_POLL_INTERVAL", 30*time.Second),
		MaxRetries:     getEnvInt("POS_MAX_RETRIES", 4),
		RetryBaseDelay: getEnvDuration("POS_RETRY_BASE_DELAY", 200*time.Millisecond),
		RetryMaxDelay:  getEnvDuration("POS_RETRY_MAX_DELAY", 10*time.Second),
		HTTPTimeout:    getEnvDuration("POS_HTTP_TIMEOUT", 5*time.Second),
	}

	venuesPath := getEnv("POS_VENUES_CONFIG", "")
	if venuesPath != "" {
		f, err := os.ReadFile(venuesPath)
		if err != nil {
			return Config{}, fmt.Errorf("read venues config %s: %w", venuesPath, err)
		}
		var vf VenuesFile
		if err := json.Unmarshal(f, &vf); err != nil {
			return Config{}, fmt.Errorf("parse venues config %s: %w", venuesPath, err)
		}
		cfg.Providers = vf.Providers
		cfg.Venues = vf.Venues
	}

	return cfg, nil
}

func getEnv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func getEnvInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func getEnvDuration(key string, def time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return def
}
