// Package kafka publishes normalized sync results and DLQ entries.
package kafka

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"

	segmentio "github.com/segmentio/kafka-go"

	"github.com/clearpath/pos-ingest/internal/metrics"
	"github.com/clearpath/pos-ingest/internal/model"
	"github.com/clearpath/pos-ingest/internal/tracing"
)

// correlationIDHeaderKey matches the Kafka header key menu-service's outbox
// relay uses (see menu-service OutboxRelay.kt), so a correlation ID looks
// the same on the wire regardless of which service produced the message.
const correlationIDHeaderKey = "correlationId"

// Producer publishes to pos.sync and pos.sync.dlq.
type Producer struct {
	syncWriter *segmentio.Writer
	dlqWriter  *segmentio.Writer
	syncTopic  string
	dlqTopic   string
	tracer     *tracing.Tracer

	// pendingPartitions correlates a PublishSync call to the partition Kafka actually assigned
	// it. segmentio/kafka-go's Writer.WriteMessages never writes the chosen partition back onto
	// the caller's Message struct — the balancer's choice is only ever used internally — so this
	// reads it off the Writer's Completion callback instead, which segmentio's own docs guarantee
	// carries the real assigned partition and (for a synchronous, non-Async writer, which this is)
	// fires before WriteMessages returns. Completion is one function shared across every
	// concurrent WriteMessages call on syncWriter, so entries are keyed by correlationID (unique
	// per poll) to match each completion back to the call that's waiting on it.
	pendingPartitions sync.Map // correlationID string -> chan int
}

func NewProducer(brokers []string, syncTopic, dlqTopic string, tracer *tracing.Tracer) *Producer {
	newWriter := func(topic string) *segmentio.Writer {
		return &segmentio.Writer{
			Addr:                   segmentio.TCP(brokers...),
			Topic:                  topic,
			Balancer:               &segmentio.Hash{},
			RequiredAcks:           segmentio.RequireAll,
			AllowAutoTopicCreation: true,
		}
	}
	p := &Producer{
		syncWriter: newWriter(syncTopic),
		dlqWriter:  newWriter(dlqTopic),
		syncTopic:  syncTopic,
		dlqTopic:   dlqTopic,
		tracer:     tracer,
	}
	p.syncWriter.Completion = p.completeSync
	return p
}

// completeSync is segmentio's Completion callback for syncWriter, invoked once per produced
// batch (all messages in one call share the same assigned partition). It hands that partition
// back to whichever PublishSync call is waiting on it, matched by the correlationId header.
func (p *Producer) completeSync(messages []segmentio.Message, _ error) {
	for _, m := range messages {
		correlationID := headerValue(m.Headers, correlationIDHeaderKey)
		if correlationID == "" {
			continue
		}
		chVal, ok := p.pendingPartitions.LoadAndDelete(correlationID)
		if !ok {
			continue
		}
		ch := chVal.(chan int)
		ch <- m.Partition
		close(ch)
	}
}

func headerValue(headers []segmentio.Header, key string) string {
	for _, h := range headers {
		if h.Key == key {
			return string(h.Value)
		}
	}
	return ""
}

// PublishSync publishes a normalized sync run to pos.sync, keyed by venue ID.
// fetchAttempts is the number of attempts the caller's upstream POS fetch took
// (1 = succeeded first try), recorded on the span as RetryCount.
func (p *Producer) PublishSync(ctx context.Context, envelope model.SyncEnvelope, fetchAttempts int) error {
	attrs := &tracing.Attributes{RetryCount: &fetchAttempts}
	return p.tracer.WithSpan(ctx, "kafka.publish "+p.syncTopic, attrs, func(ctx context.Context) error {
		payload, err := json.Marshal(envelope)
		if err != nil {
			return fmt.Errorf("marshal sync envelope: %w", err)
		}
		msgs := []segmentio.Message{{
			Key:   []byte(envelope.VenueID),
			Value: payload,
			Headers: []segmentio.Header{
				{Key: correlationIDHeaderKey, Value: []byte(envelope.CorrelationID)},
			},
		}}

		partitionCh := make(chan int, 1)
		p.pendingPartitions.Store(envelope.CorrelationID, partitionCh)

		if err := p.syncWriter.WriteMessages(ctx, msgs...); err != nil {
			p.pendingPartitions.Delete(envelope.CorrelationID)
			return fmt.Errorf("publish pos.sync: %w", err)
		}

		// WriteMessages on a synchronous (non-Async) writer blocks until Completion has already
		// run, so completeSync has already sent on this channel by the time we get here.
		partition := <-partitionCh
		attrs.KafkaPartition = &partition
		return nil
	})
}

// PublishDLQ publishes a failed sync attempt to pos.sync.dlq after retries
// are exhausted.
func (p *Producer) PublishDLQ(ctx context.Context, envelope model.DLQEnvelope) error {
	return p.tracer.WithSpan(ctx, "kafka.publish "+p.dlqTopic, nil, func(ctx context.Context) error {
		payload, err := json.Marshal(envelope)
		if err != nil {
			return fmt.Errorf("marshal dlq envelope: %w", err)
		}
		msg := segmentio.Message{
			Key:   []byte(envelope.VenueID),
			Value: payload,
			Headers: []segmentio.Header{
				{Key: correlationIDHeaderKey, Value: []byte(envelope.CorrelationID)},
			},
		}
		if err := p.dlqWriter.WriteMessages(ctx, msg); err != nil {
			return fmt.Errorf("publish pos.sync.dlq: %w", err)
		}
		metrics.DLQPublishedTotal.Inc()
		return nil
	})
}

func (p *Producer) Close() error {
	err1 := p.syncWriter.Close()
	err2 := p.dlqWriter.Close()
	if err1 != nil {
		return err1
	}
	return err2
}
