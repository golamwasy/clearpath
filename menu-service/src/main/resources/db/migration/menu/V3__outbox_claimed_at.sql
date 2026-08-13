-- Lets the relay claim a row (short transaction, releases its FOR UPDATE SKIP LOCKED lock
-- immediately) before publishing to Kafka, instead of holding a live transaction/DB connection
-- across the Kafka network round-trip. claimed_at also lets a claim be reclaimed after a lease
-- timeout if the relay instance that claimed it crashes before publishing.
ALTER TABLE outbox ADD COLUMN claimed_at TIMESTAMPTZ;
