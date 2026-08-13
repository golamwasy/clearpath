package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/clearpath/pos-ingest/internal/api"
	"github.com/clearpath/pos-ingest/internal/config"
	"github.com/clearpath/pos-ingest/internal/kafka"
	"github.com/clearpath/pos-ingest/internal/provider"
	"github.com/clearpath/pos-ingest/internal/ratelimit"
	"github.com/clearpath/pos-ingest/internal/store"
	"github.com/clearpath/pos-ingest/internal/tracing"
	"github.com/clearpath/pos-ingest/internal/worker"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	cfg, err := config.Load()
	if err != nil {
		logger.Error("failed to load config", "error", err)
		os.Exit(1)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	tracer := tracing.NewTracer("pos-ingest", cfg.KafkaBrokers, cfg.SystemTraceTopic, logger)
	defer tracer.Close()

	st, err := store.New(ctx, cfg.DBURL, tracer)
	if err != nil {
		logger.Error("failed to connect to postgres", "error", err)
		os.Exit(1)
	}
	defer st.Close()

	producer := kafka.NewProducer(cfg.KafkaBrokers, cfg.SyncTopic, cfg.DLQTopic, tracer)
	defer producer.Close()

	providers, err := buildProviders(cfg)
	if err != nil {
		logger.Error("failed to build providers", "error", err)
		os.Exit(1)
	}

	pool := worker.NewPool(
		cfg.Venues,
		providers,
		st,
		producer,
		cfg.MaxConcurrency,
		cfg.MaxRetries,
		cfg.RetryBaseDelay,
		cfg.RetryMaxDelay,
		logger,
	)
	go pool.Run(ctx, cfg.PollInterval)

	handlers := api.NewHandlers(st, pool, st, logger, tracer, pool, cfg.ChaosEnabled)
	httpServer := &http.Server{
		Addr:    ":" + cfg.HTTPPort,
		Handler: handlers.Routes(),
	}

	go func() {
		logger.Info("pos-ingest listening", "port", cfg.HTTPPort)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("http server failed", "error", err)
			os.Exit(1)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	logger.Info("shutting down")
	cancel()

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()
	_ = httpServer.Shutdown(shutdownCtx)

	// Wait for any venue-poll goroutines already in flight when cancel() fired, bounded by the
	// same shutdown deadline, so a sync_runs row doesn't get abandoned at status=running.
	pool.Wait(shutdownCtx)
}

func buildProviders(cfg config.Config) (map[string]provider.Provider, error) {
	providers := make(map[string]provider.Provider, len(cfg.Providers))
	for _, pc := range cfg.Providers {
		client := &http.Client{Timeout: cfg.HTTPTimeout}
		limiter := ratelimit.New(pc.RateRPS, pc.RateBurst)

		switch pc.Kind {
		case "nested":
			providers[pc.Name] = provider.NewNestedProvider(pc.Name, pc.BaseURL, client, limiter)
		case "flat":
			providers[pc.Name] = provider.NewFlatProvider(pc.Name, pc.BaseURL, pc.Currency, client, limiter)
		default:
			return nil, fmt.Errorf("unknown provider kind %q for provider %q", pc.Kind, pc.Name)
		}
	}
	return providers, nil
}
