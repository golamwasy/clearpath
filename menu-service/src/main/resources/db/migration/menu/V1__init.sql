CREATE TABLE venues (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE categories (
    id UUID PRIMARY KEY,
    venue_id UUID NOT NULL REFERENCES venues(id),
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_categories_venue_id ON categories(venue_id);

CREATE TABLE items (
    id UUID PRIMARY KEY,
    venue_id UUID NOT NULL REFERENCES venues(id),
    category_id UUID REFERENCES categories(id),
    name TEXT NOT NULL,
    description TEXT,
    version INTEGER NOT NULL DEFAULT 0,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_items_venue_id ON items(venue_id);

CREATE TABLE modifiers (
    id UUID PRIMARY KEY,
    item_id UUID NOT NULL REFERENCES items(id),
    name TEXT NOT NULL,
    price_delta_cents BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX idx_modifiers_item_id ON modifiers(item_id);

CREATE TABLE prices (
    id UUID PRIMARY KEY,
    item_id UUID NOT NULL REFERENCES items(id),
    currency CHAR(3) NOT NULL,
    amount_cents BIGINT NOT NULL,
    effective_from TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_prices_item_id ON prices(item_id);

CREATE TABLE outbox (
    id BIGSERIAL PRIMARY KEY,
    aggregate_type TEXT NOT NULL,
    aggregate_id UUID NOT NULL,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    correlation_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at TIMESTAMPTZ
);

CREATE INDEX idx_outbox_unpublished ON outbox(id) WHERE published_at IS NULL;
