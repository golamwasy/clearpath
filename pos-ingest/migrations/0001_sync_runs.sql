CREATE TABLE IF NOT EXISTS sync_runs (
    id             UUID PRIMARY KEY,
    venue_id       TEXT NOT NULL,
    provider       TEXT NOT NULL,
    started_at     TIMESTAMPTZ NOT NULL,
    finished_at    TIMESTAMPTZ,
    items_changed  INT NOT NULL DEFAULT 0,
    status         TEXT NOT NULL,
    error          TEXT,
    correlation_id TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS sync_runs_venue_started_idx ON sync_runs (venue_id, started_at DESC);
