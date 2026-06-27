-- Currency: global default + per booking link / appointment (PostgreSQL / Neon)

INSERT INTO _meta (key, value) VALUES ('default_currency', 'USD')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE booking_links ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD';
