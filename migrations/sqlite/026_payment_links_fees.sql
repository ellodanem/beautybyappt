-- Payment links (price-only), pending payments queue, Stripe fee passthrough

INSERT OR IGNORE INTO _meta (key, value) VALUES ('stripe_fee_passthrough_enabled', '0');
INSERT OR IGNORE INTO _meta (key, value) VALUES ('stripe_fee_percent', '0.039');
INSERT OR IGNORE INTO _meta (key, value) VALUES ('stripe_fee_fixed', '0.30');

CREATE TABLE IF NOT EXISTS payment_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  quoted_total REAL NOT NULL DEFAULT 0,
  deposit_amount REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at TEXT,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  pending_payment_id INTEGER,
  stripe_checkout_session_id TEXT,
  fee_passthrough INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_payment_links_token ON payment_links(token);
CREATE INDEX IF NOT EXISTS idx_payment_links_status ON payment_links(status);

CREATE TABLE IF NOT EXISTS pending_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_link_id INTEGER REFERENCES payment_links(id) ON DELETE SET NULL,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  quoted_total REAL NOT NULL DEFAULT 0,
  amount_paid REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  client_was_existing INTEGER NOT NULL DEFAULT 0,
  appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  stripe_checkout_session_id TEXT,
  stripe_payment_intent_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  applied_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_pending_payments_status ON pending_payments(status);
CREATE INDEX IF NOT EXISTS idx_pending_payments_client ON pending_payments(client_id);
