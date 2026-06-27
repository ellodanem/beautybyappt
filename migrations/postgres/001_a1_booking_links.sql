-- A1: Custom booking links + client address (PostgreSQL / Neon)

ALTER TABLE clients ADD COLUMN IF NOT EXISTS address TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS booking_links (
  id BIGSERIAL PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  staff_id BIGINT NOT NULL REFERENCES staff(id),
  scheduled_date DATE NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  total_price DECIMAL(10, 2) NOT NULL DEFAULT 0,
  deposit_amount DECIMAL(10, 2) NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  service_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMPTZ,
  appointment_id BIGINT REFERENCES appointments(id),
  client_id BIGINT REFERENCES clients(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ,
  CONSTRAINT booking_links_status_check CHECK (
    status IN ('pending', 'confirmed', 'expired', 'cancelled')
  )
);

CREATE INDEX IF NOT EXISTS idx_booking_links_token ON booking_links(token);
CREATE INDEX IF NOT EXISTS idx_booking_links_status ON booking_links(status);
CREATE INDEX IF NOT EXISTS idx_booking_links_expires_at ON booking_links(expires_at);
