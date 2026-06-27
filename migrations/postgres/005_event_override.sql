-- Event days block regular bookings (PostgreSQL / Neon)

INSERT INTO _meta (key, value) VALUES ('block_regular_on_event_days', '1')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE offerings ADD COLUMN IF NOT EXISTS block_regular_bookings INTEGER;
