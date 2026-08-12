package retry

import (
	"context"
	"errors"
	"testing"
	"time"
)

var errNetwork = errors.New("network error")
var errPermanent = errors.New("permanent error")

func fakeSleep(record *[]time.Duration) func(context.Context, time.Duration) error {
	return func(_ context.Context, d time.Duration) error {
		*record = append(*record, d)
		return nil
	}
}

func TestDo_SucceedsOnFirstAttempt(t *testing.T) {
	calls := 0
	result, err := Do(context.Background(), Config{MaxAttempts: 3, BaseDelay: time.Millisecond}, func(ctx context.Context) (string, error) {
		calls++
		return "ok", nil
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result != "ok" || calls != 1 {
		t.Fatalf("expected 1 call and result ok, got %d calls, result %q", calls, result)
	}
}

func TestDo_RetriesUntilSuccess(t *testing.T) {
	var sleeps []time.Duration
	calls := 0
	result, err := Do(context.Background(), Config{
		MaxAttempts: 5,
		BaseDelay:   time.Millisecond,
		Sleep:       fakeSleep(&sleeps),
		Rand:        func() float64 { return 1.0 },
	}, func(ctx context.Context) (string, error) {
		calls++
		if calls < 3 {
			return "", errNetwork
		}
		return "ok", nil
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result != "ok" {
		t.Fatalf("expected ok, got %q", result)
	}
	if calls != 3 {
		t.Fatalf("expected 3 attempts, got %d", calls)
	}
	if len(sleeps) != 2 {
		t.Fatalf("expected 2 sleeps between 3 attempts, got %d", len(sleeps))
	}
}

func TestDo_ExhaustsAttempts(t *testing.T) {
	var sleeps []time.Duration
	calls := 0
	_, err := Do(context.Background(), Config{
		MaxAttempts: 3,
		BaseDelay:   time.Millisecond,
		Sleep:       fakeSleep(&sleeps),
		Rand:        func() float64 { return 1.0 },
	}, func(ctx context.Context) (string, error) {
		calls++
		return "", errNetwork
	})
	if calls != 3 {
		t.Fatalf("expected 3 attempts, got %d", calls)
	}
	var exhausted *ErrExhausted
	if !errors.As(err, &exhausted) {
		t.Fatalf("expected *ErrExhausted, got %v", err)
	}
	if exhausted.Attempts != 3 {
		t.Fatalf("expected Attempts=3, got %d", exhausted.Attempts)
	}
	if !errors.Is(err, errNetwork) {
		t.Fatalf("expected wrapped errNetwork, got %v", err)
	}
	// MaxAttempts-1 sleeps occur between attempts, none after the last.
	if len(sleeps) != 2 {
		t.Fatalf("expected 2 sleeps, got %d", len(sleeps))
	}
}

func TestDo_NonRetryableErrorStopsImmediately(t *testing.T) {
	calls := 0
	_, err := Do(context.Background(), Config{
		MaxAttempts: 5,
		BaseDelay:   time.Millisecond,
		Retryable:   func(err error) bool { return !errors.Is(err, errPermanent) },
	}, func(ctx context.Context) (string, error) {
		calls++
		return "", errPermanent
	})
	if calls != 1 {
		t.Fatalf("expected exactly 1 attempt for non-retryable error, got %d", calls)
	}
	if !errors.Is(err, errPermanent) {
		t.Fatalf("expected errPermanent, got %v", err)
	}
	var exhausted *ErrExhausted
	if errors.As(err, &exhausted) {
		t.Fatalf("non-retryable error should not be wrapped as ErrExhausted")
	}
}

func TestDo_BackoffStaysWithinBounds(t *testing.T) {
	var sleeps []time.Duration
	base := 10 * time.Millisecond
	maxDelay := 60 * time.Millisecond
	_, _ = Do(context.Background(), Config{
		MaxAttempts: 6,
		BaseDelay:   base,
		MaxDelay:    maxDelay,
		Sleep:       fakeSleep(&sleeps),
		Rand:        func() float64 { return 1.0 }, // max jitter, so sleep == capped delay
	}, func(ctx context.Context) (string, error) {
		return "", errNetwork
	})

	if len(sleeps) != 5 {
		t.Fatalf("expected 5 sleeps for 6 attempts, got %d", len(sleeps))
	}
	for i, d := range sleeps {
		if d > maxDelay {
			t.Errorf("sleep[%d] = %v exceeds maxDelay %v", i, d, maxDelay)
		}
		if d < 0 {
			t.Errorf("sleep[%d] = %v is negative", i, d)
		}
	}
	// Uncapped attempt 0 delay should be base*2^0 = base.
	if sleeps[0] != base {
		t.Errorf("expected first sleep to equal base delay %v, got %v", base, sleeps[0])
	}
	// By the later attempts backoff should have hit the cap.
	if sleeps[len(sleeps)-1] != maxDelay {
		t.Errorf("expected final sleep capped at %v, got %v", maxDelay, sleeps[len(sleeps)-1])
	}
}

func TestDo_ContextCancellationDuringSleep(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	calls := 0
	_, err := Do(ctx, Config{
		MaxAttempts: 3,
		BaseDelay:   time.Millisecond,
	}, func(ctx context.Context) (string, error) {
		calls++
		return "", errNetwork
	})
	if err == nil {
		t.Fatal("expected error from cancelled context")
	}
	if calls != 1 {
		t.Fatalf("expected 1 attempt before cancellation aborted retry, got %d", calls)
	}
}
