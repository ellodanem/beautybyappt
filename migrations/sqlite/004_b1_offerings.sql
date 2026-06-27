-- B1: Seasonal bookable offerings (SQLite / D1)

CREATE TABLE IF NOT EXISTS offerings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  base_price REAL NOT NULL DEFAULT 0,
  duration INTEGER NOT NULL DEFAULT 60,
  color TEXT NOT NULL DEFAULT '#ec4899',
  category TEXT NOT NULL DEFAULT 'Seasonal',
  status TEXT NOT NULL DEFAULT 'draft',
  capacity_per_slot INTEGER NOT NULL DEFAULT 1,
  staff_ids TEXT NOT NULL DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS offering_date_windows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  offering_id INTEGER NOT NULL REFERENCES offerings(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS offering_time_slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  offering_id INTEGER NOT NULL REFERENCES offerings(id) ON DELETE CASCADE,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS offering_addons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  offering_id INTEGER NOT NULL REFERENCES offerings(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price REAL NOT NULL DEFAULT 0,
  extra_duration INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS offering_slot_instances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  offering_id INTEGER NOT NULL REFERENCES offerings(id) ON DELETE CASCADE,
  slot_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 1,
  booked_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(offering_id, slot_date, start_time)
);

CREATE TABLE IF NOT EXISTS appointment_offering_addons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  offering_addon_id INTEGER NOT NULL REFERENCES offering_addons(id),
  price REAL NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_offerings_status ON offerings(status);
CREATE INDEX IF NOT EXISTS idx_offering_date_windows_offering ON offering_date_windows(offering_id);
CREATE INDEX IF NOT EXISTS idx_offering_slot_instances_date ON offering_slot_instances(slot_date);

-- Run after offering_slot_instances exists:
-- ALTER TABLE appointments ADD COLUMN offering_slot_instance_id INTEGER REFERENCES offering_slot_instances(id);
-- CREATE INDEX IF NOT EXISTS idx_appointments_offering_slot ON appointments(offering_slot_instance_id);
