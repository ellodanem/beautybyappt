-- A1: Custom booking links (SQLite / D1)
-- clients.address is in src/server/schema.sql CREATE for new installs.
-- Existing DBs: run once manually:
--   ALTER TABLE clients ADD COLUMN address TEXT DEFAULT '';

CREATE TABLE IF NOT EXISTS booking_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  scheduled_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  total_price REAL NOT NULL DEFAULT 0,
  deposit_amount REAL NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  service_ids TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at TEXT,
  appointment_id INTEGER REFERENCES appointments(id),
  client_id INTEGER REFERENCES clients(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_booking_links_token ON booking_links(token);
CREATE INDEX IF NOT EXISTS idx_booking_links_status ON booking_links(status);
