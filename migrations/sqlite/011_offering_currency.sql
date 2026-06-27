-- Per-offering currency (e.g. Carnival priced in USD while salon default is XCD)

ALTER TABLE offerings ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD';
