// Package tracing emits spans to system.trace, fire and forget. It mirrors
// tracing-core (the Kotlin equivalent) field for field on the wire, but uses
// Go's context.Context for ambient correlation/span propagation instead of
// tracing-core's explicit TraceContext parameter — context.Context is
// already the idiomatic mechanism threaded through every call in this
// codebase (see pool.go, store.go, kafka/producer.go), unlike Kotlin where
// no equivalent safe-across-dispatchers ambient exists without extra
// ceremony. See docs/adr/0003-tracing-wire-format.md.
package tracing

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"time"

	segmentio "github.com/segmentio/kafka-go"
)

const correlationIDHeaderKey = "correlationId"

// Span is the wire format published to system.trace. Field names and types
// match tracing-core's Span.kt exactly.
type Span struct {
	CorrelationID string  `json:"correlationId"`
	SpanID        string  `json:"spanId"`
	ParentSpanID  *string `json:"parentSpanId"`
	Service       string  `json:"service"`
	Operation     string  `json:"operation"`
	StartedAt     string  `json:"startedAt"`
	FinishedAt    string  `json:"finishedAt"`
	DurationMs    int64   `json:"durationMs"`
	Status        string  `json:"status"`
	Error         *string `json:"error"`
	Root          bool    `json:"root"`
}

type traceState struct {
	correlationID string
	spanID        string // nearest enclosing span; empty means no known parent
}

type traceStateKey struct{}

// WithCorrelationID seeds ctx with a correlation ID and no parent span —
// the entry point for a new trace (or a continuation whose parent span
// wasn't propagated, e.g. an inbound HTTP request with only a correlation
// ID header).
func WithCorrelationID(ctx context.Context, correlationID string) context.Context {
	return context.WithValue(ctx, traceStateKey{}, traceState{correlationID: correlationID})
}

// CorrelationID returns the ambient correlation ID, or "" if none was set.
func CorrelationID(ctx context.Context) string {
	if st, ok := ctx.Value(traceStateKey{}).(traceState); ok {
		return st.correlationID
	}
	return ""
}

// Tracer publishes spans to system.trace.
type Tracer struct {
	service string
	writer  *segmentio.Writer
	logger  *slog.Logger
}

func NewTracer(service string, brokers []string, topic string, logger *slog.Logger) *Tracer {
	return &Tracer{
		service: service,
		writer: &segmentio.Writer{
			Addr:                   segmentio.TCP(brokers...),
			Topic:                  topic,
			Balancer:               &segmentio.Hash{},
			RequiredAcks:           segmentio.RequireOne,
			AllowAutoTopicCreation: true,
		},
		logger: logger,
	}
}

func (t *Tracer) Close() error {
	return t.writer.Close()
}

// WithSpan runs fn under a new child span of ctx's trace state, and emits
// that span asynchronously afterward regardless of whether fn succeeded —
// an error is recorded as status=error and still returned unchanged, so
// tracing observes failures without ever swallowing them or blocking the
// caller on the publish.
func (t *Tracer) WithSpan(ctx context.Context, operation string, fn func(context.Context) error) error {
	parent, _ := ctx.Value(traceStateKey{}).(traceState)
	spanID := newSpanID()
	child := traceState{correlationID: parent.correlationID, spanID: spanID}
	childCtx := context.WithValue(ctx, traceStateKey{}, child)

	start := time.Now().UTC()
	err := fn(childCtx)
	finish := time.Now().UTC()

	status := "ok"
	var errMsg *string
	if err != nil {
		status = "error"
		msg := err.Error()
		errMsg = &msg
	}
	t.emit(child, parent.spanID, operation, start, finish, status, errMsg)
	return err
}

func (t *Tracer) emit(state traceState, parentSpanID, operation string, start, finish time.Time, status string, errMsg *string) {
	var parent *string
	if parentSpanID != "" {
		parent = &parentSpanID
	}
	span := Span{
		CorrelationID: state.correlationID,
		SpanID:        state.spanID,
		ParentSpanID:  parent,
		Service:       t.service,
		Operation:     operation,
		StartedAt:     start.Format(time.RFC3339Nano),
		FinishedAt:    finish.Format(time.RFC3339Nano),
		DurationMs:    finish.Sub(start).Milliseconds(),
		Status:        status,
		Error:         errMsg,
		Root:          parentSpanID == "",
	}

	go func() {
		payload, err := json.Marshal(span)
		if err != nil {
			t.logger.Warn("failed to marshal span", "operation", operation, "error", err)
			return
		}
		msg := segmentio.Message{
			Key:   []byte(span.CorrelationID),
			Value: payload,
			Headers: []segmentio.Header{
				{Key: correlationIDHeaderKey, Value: []byte(span.CorrelationID)},
			},
		}
		if err := t.writer.WriteMessages(context.Background(), msg); err != nil {
			t.logger.Warn("failed to publish span", "operation", operation, "error", err)
		}
	}()
}

func newSpanID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}
