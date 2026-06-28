-- Stripe checkout for public anytime service bookings

CREATE TABLE IF NOT EXISTS anytime_booking_checkouts (
  id SERIAL PRIMARY KEY,
  service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  service_slug TEXT NOT NULL DEFAULT '',
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  scheduled_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
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

CREATE INDEX IF NOT EXISTS idx_anytime_checkouts_date ON anytime_booking_checkouts(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_anytime_checkouts_session ON anytime_booking_checkouts(stripe_checkout_session_id);
CREATE INDEX IF NOT EXISTS idx_anytime_checkouts_status ON anytime_booking_checkouts(status);
