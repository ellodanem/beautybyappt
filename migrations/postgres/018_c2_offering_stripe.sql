-- C2: Stripe deposits on public offering bookings

CREATE TABLE IF NOT EXISTS offering_booking_checkouts (
  id SERIAL PRIMARY KEY,
  offering_id INTEGER NOT NULL REFERENCES offerings(id) ON DELETE CASCADE,
  slot_instance_id INTEGER NOT NULL REFERENCES offering_slot_instances(id) ON DELETE CASCADE,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  addon_ids TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  total_price DECIMAL(10, 2) NOT NULL,
  deposit_amount DECIMAL(10, 2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  payment_choice TEXT NOT NULL DEFAULT 'full',
  stripe_checkout_session_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMPTZ NOT NULL,
  appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_offering_checkouts_slot ON offering_booking_checkouts(slot_instance_id);
CREATE INDEX IF NOT EXISTS idx_offering_checkouts_session ON offering_booking_checkouts(stripe_checkout_session_id);
CREATE INDEX IF NOT EXISTS idx_offering_checkouts_status ON offering_booking_checkouts(status);
