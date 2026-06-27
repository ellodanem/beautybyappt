-- Currency: global default + per link (SQLite / D1)
-- Existing DBs: run each statement once if columns missing.

INSERT OR IGNORE INTO _meta (key, value) VALUES ('default_currency', 'USD');

-- ALTER TABLE booking_links ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD';
-- ALTER TABLE appointments ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD';
