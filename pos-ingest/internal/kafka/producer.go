// Package kafka publishes normalized sync results and DLQ entries.
package kafka

import (
	"context"
	"encoding/json"
	"fmt"

	segmentio "github.com/segmentio/kafka-go"

	"github.com/clearpath/pos-ingest/internal/model"
)

// correlationIDHeaderKey matches the Kafka header key menu-service's outbox
// relay uses (see menu-service OutboxRelay.kt), so a correlation ID looks
// the same on the wire regardless of which service produced the message.
const correlationIDHeaderKey = "correlationId"

// Producer publishes to pos.sync and pos.sync.dlq.
type Producer struct {
	syncWriter *segmentio.Writer
	dlqWriter  *segmentio.Writer
}

func NewProducer(brokers []string, syncTopic, dlqTopic string) *Producer {
	newWriter := func(topic string) *segmentio.Writer {
		return &segmentio.Writer{
			Addr:                   segmentio.TCP(brokers...),
			Topic:                  topic,
			Balancer:               &segmentio.Hash{},
			RequiredAcks:           segmentio.RequireAll,
			AllowAutoTopicCreation: true,
		}
	}
	return &Producer{
		syncWriter: newWriter(syncTopic),
		dlqWriter:  newWriter(dlqTopic),
	}
}

// PublishSync publishes a normalized sync run to pos.sync, keyed by venue ID.
func (p *Producer) PublishSync(ctx context.Context, envelope model.SyncEnvelope) error {
	payload, err := json.Marshal(envelope)
	if err != nil {
		return fmt.Errorf("marshal sync envelope: %w", err)
	}
	msg := segmentio.Message{
		Key:   []byte(envelope.VenueID),
		Value: payload,
		Headers: []segmentio.Header{
			{Key: correlationIDHeaderKey, Value: []byte(envelope.CorrelationID)},
		},
	}
	if err := p.syncWriter.WriteMessages(ctx, msg); err != nil {
		return fmt.Errorf("publish pos.sync: %w", err)
	}
	return nil
}

// PublishDLQ publishes a failed sync attempt to pos.sync.dlq after retries
// are exhausted.
func (p *Producer) PublishDLQ(ctx context.Context, envelope model.DLQEnvelope) error {
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
	return nil
}

func (p *Producer) Close() error {
	err1 := p.syncWriter.Close()
	err2 := p.dlqWriter.Close()
	if err1 != nil {
		return err1
	}
	return err2
}
