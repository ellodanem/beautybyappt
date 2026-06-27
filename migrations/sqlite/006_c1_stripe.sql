-- C1: Stripe deposits on booking links

ALTER TABLE appointments ADD COLUMN deposit_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE appointments ADD COLUMN amount_paid REAL NOT NULL DEFAULT 0;
ALTER TABLE appointments ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'unpaid';
ALTER TABLE appointments ADD COLUMN stripe_checkout_session_id TEXT;
ALTER TABLE appointments ADD COLUMN stripe_payment_intent_id TEXT;

ALTER TABLE booking_links ADD COLUMN stripe_checkout_session_id TEXT;

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  booking_link_id INTEGER REFERENCES booking_links(id) ON DELETE SET NULL,
  stripe_checkout_session_id TEXT,
  stripe_payment_intent_id TEXT,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_payments_appointment ON payments(appointment_id);
CREATE INDEX IF NOT EXISTS idx_payments_booking_link ON payments(booking_link_id);
CREATE INDEX IF NOT EXISTS idx_payments_stripe_session ON payments(stripe_checkout_session_id);
