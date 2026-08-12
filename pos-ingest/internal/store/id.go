package store

import (
	"crypto/rand"
	"fmt"
)

// newUUID generates a random UUIDv4 using only crypto/rand, matching the
// Go conventions in CLAUDE.md (stdlib plus pgx/kafka-go only).
func newUUID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = (b[6] & 0x0f) | 0x40 // version 4
	b[8] = (b[8] & 0x3f) | 0x80 // variant 10
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
