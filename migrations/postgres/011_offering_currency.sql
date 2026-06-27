-- Per-offering currency (e.g. Carnival priced in USD while salon default is XCD)

ALTER TABLE offerings ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD';
