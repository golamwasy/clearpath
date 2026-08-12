ALTER TABLE items ADD COLUMN price_cents BIGINT;
ALTER TABLE items ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_items_venue_sort ON items(venue_id, sort_order);
