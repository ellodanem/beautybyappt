-- B1: Seasonal bookable offerings (PostgreSQL / Neon)

CREATE TABLE IF NOT EXISTS offerings (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  base_price DECIMAL(10, 2) NOT NULL DEFAULT 0,
  duration INTEGER NOT NULL DEFAULT 60,
  color TEXT NOT NULL DEFAULT '#ec4899',
  category TEXT NOT NULL DEFAULT 'Seasonal',
  status TEXT NOT NULL DEFAULT 'draft',
  capacity_per_slot INTEGER NOT NULL DEFAULT 1,
  staff_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT offerings_status_check CHECK (
    status IN ('draft', 'live', 'completed', 'archived')
  )
);

CREATE TABLE IF NOT EXISTS offering_date_windows (
  id BIGSERIAL PRIMARY KEY,
  offering_id BIGINT NOT NULL REFERENCES offerings(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL
);

CREATE TABLE IF NOT EXISTS offering_time_slots (
  id BIGSERIAL PRIMARY KEY,
  offering_id BIGINT NOT NULL REFERENCES offerings(id) ON DELETE CASCADE,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS offering_addons (
  id BIGSERIAL PRIMARY KEY,
  offering_id BIGINT NOT NULL REFERENCES offerings(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price DECIMAL(10, 2) NOT NULL DEFAULT 0,
  extra_duration INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS offering_slot_instances (
  id BIGSERIAL PRIMARY KEY,
  offering_id BIGINT NOT NULL REFERENCES offerings(id) ON DELETE CASCADE,
  slot_date DATE NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 1,
  booked_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(offering_id, slot_date, start_time)
);

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS offering_slot_instance_id BIGINT
  REFERENCES offering_slot_instances(id);

CREATE TABLE IF NOT EXISTS appointment_offering_addons (
  id BIGSERIAL PRIMARY KEY,
  appointment_id BIGINT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  offering_addon_id BIGINT NOT NULL REFERENCES offering_addons(id),
  price DECIMAL(10, 2) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_offerings_status ON offerings(status);
CREATE INDEX IF NOT EXISTS idx_offering_date_windows_offering ON offering_date_windows(offering_id);
CREATE INDEX IF NOT EXISTS idx_offering_slot_instances_date ON offering_slot_instances(slot_date);
CREATE INDEX IF NOT EXISTS idx_appointments_offering_slot ON appointments(offering_slot_instance_id);
