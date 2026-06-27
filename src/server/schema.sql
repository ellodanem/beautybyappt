-- Clients (customers who book appointments)
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  address TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Staff members (stylists, therapists, technicians, etc.)
CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  title TEXT DEFAULT '',
  color TEXT NOT NULL DEFAULT '#7c3aed',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Services offered (haircut, massage, manicure, etc.)
CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  description TEXT DEFAULT '',
  duration INTEGER NOT NULL DEFAULT 60,
  price REAL NOT NULL DEFAULT 0,
  color TEXT NOT NULL DEFAULT '#6b7280',
  category TEXT DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Appointments (bookings)
CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  identifier TEXT NOT NULL UNIQUE,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'booked',
  scheduled_date TEXT NOT NULL DEFAULT (date('now')),
  start_time TEXT NOT NULL DEFAULT '09:00',
  end_time TEXT NOT NULL DEFAULT '10:00',
  total_price REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  deposit_amount REAL NOT NULL DEFAULT 0,
  amount_paid REAL NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'unpaid',
  stripe_checkout_session_id TEXT,
  stripe_payment_intent_id TEXT,
  travel_fee REAL NOT NULL DEFAULT 0,
  service_address TEXT NOT NULL DEFAULT '',
  notes TEXT DEFAULT '',
  is_recurring INTEGER NOT NULL DEFAULT 0,
  recurrence_interval TEXT DEFAULT '',
  offering_slot_instance_id INTEGER,
  reminder_24h_sent_at TEXT,
  reminder_2h_sent_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Services included in an appointment (many-to-many)
CREATE TABLE IF NOT EXISTS appointment_services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  price REAL NOT NULL DEFAULT 0,
  duration INTEGER NOT NULL DEFAULT 60
);

-- Appointment notes / activity log
CREATE TABLE IF NOT EXISTS appointment_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Blocked time slots (breaks, days off, lunch, etc.)
CREATE TABLE IF NOT EXISTS blocked_slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  blocked_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  reason TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

-- Products (inventory: shampoo, creams, tools, etc.)
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  brand TEXT DEFAULT '',
  category TEXT DEFAULT '',
  sku TEXT DEFAULT '',
  price REAL NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0,
  stock INTEGER NOT NULL DEFAULT 0,
  low_stock_alert INTEGER NOT NULL DEFAULT 5,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Auto-incrementing identifier counter
CREATE TABLE IF NOT EXISTS _meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO _meta (key, value) VALUES ('appointment_counter', '0');
INSERT OR IGNORE INTO _meta (key, value) VALUES ('appointment_prefix', 'APT');
INSERT OR IGNORE INTO _meta (key, value) VALUES ('default_currency', 'USD');
INSERT OR IGNORE INTO _meta (key, value) VALUES ('business_name', '');
INSERT OR IGNORE INTO _meta (key, value) VALUES ('business_tagline', '');
INSERT OR IGNORE INTO _meta (key, value) VALUES ('logo_url', '');
INSERT OR IGNORE INTO _meta (key, value) VALUES ('block_regular_on_event_days', '1');
INSERT OR IGNORE INTO _meta (key, value) VALUES ('notify_email_enabled', '1');
INSERT OR IGNORE INTO _meta (key, value) VALUES ('notify_sms_enabled', '0');
INSERT OR IGNORE INTO _meta (key, value) VALUES ('notify_whatsapp_enabled', '0');
INSERT OR IGNORE INTO _meta (key, value) VALUES ('email_reply_to', '');
INSERT OR IGNORE INTO _meta (key, value) VALUES ('remind_24h_enabled', '1');
INSERT OR IGNORE INTO _meta (key, value) VALUES ('remind_2h_enabled', '1');
INSERT OR IGNORE INTO _meta (key, value) VALUES ('stripe_payments_enabled', '0');
INSERT OR IGNORE INTO _meta (key, value) VALUES ('business_utc_offset', '-4');
INSERT OR IGNORE INTO _meta (key, value) VALUES ('business_country', 'LC');
INSERT OR IGNORE INTO _meta (key, value) VALUES ('business_timezone', 'America/St_Lucia');
INSERT OR IGNORE INTO _meta (key, value) VALUES ('email_domain', '');
INSERT OR IGNORE INTO _meta (key, value) VALUES ('resend_domain_id', '');
INSERT OR IGNORE INTO _meta (key, value) VALUES ('email_domain_status', '');
INSERT OR IGNORE INTO _meta (key, value) VALUES ('email_domain_records', '[]');
INSERT OR IGNORE INTO _meta (key, value) VALUES ('email_from_address', '');

-- Custom booking links (A1)
CREATE TABLE IF NOT EXISTS booking_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  staff_id INTEGER NOT NULL REFERENCES staff(id),
  scheduled_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  total_price REAL NOT NULL DEFAULT 0,
  deposit_amount REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  notes TEXT NOT NULL DEFAULT '',
  service_ids TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at TEXT,
  appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  stripe_checkout_session_id TEXT,
  travel_fee REAL NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  confirmed_at TEXT
);

-- Demo data: seed once on fresh installs only (never re-seed after deletions).
INSERT OR IGNORE INTO _meta (key, value)
SELECT 'seed_demo_data', '1'
WHERE EXISTS (SELECT 1 FROM clients LIMIT 1)
   OR EXISTS (SELECT 1 FROM staff LIMIT 1)
   OR EXISTS (SELECT 1 FROM services LIMIT 1)
   OR EXISTS (SELECT 1 FROM products LIMIT 1);

-- Example staff
INSERT INTO staff (id, name, email, title, color)
SELECT 1, 'Alex', 'alex@example.com', 'Senior Stylist', '#3b82f6'
WHERE NOT EXISTS (SELECT 1 FROM _meta WHERE key = 'seed_demo_data' AND value = '1');
INSERT INTO staff (id, name, email, title, color)
SELECT 2, 'Jordan', 'jordan@example.com', 'Therapist', '#10b981'
WHERE NOT EXISTS (SELECT 1 FROM _meta WHERE key = 'seed_demo_data' AND value = '1');
INSERT INTO staff (id, name, email, title, color)
SELECT 3, 'Sam', 'sam@example.com', 'Specialist', '#f59e0b'
WHERE NOT EXISTS (SELECT 1 FROM _meta WHERE key = 'seed_demo_data' AND value = '1');
INSERT INTO staff (id, name, email, title, color)
SELECT 4, 'Taylor', 'taylor@example.com', 'Junior Stylist', '#8b5cf6'
WHERE NOT EXISTS (SELECT 1 FROM _meta WHERE key = 'seed_demo_data' AND value = '1');

-- Example services (generic so they work across verticals)
INSERT INTO services (id, name, description, duration, price, color, category)
SELECT 1, 'Standard Session', 'Standard appointment', 60, 50, '#3b82f6', 'General'
WHERE NOT EXISTS (SELECT 1 FROM _meta WHERE key = 'seed_demo_data' AND value = '1');
INSERT INTO services (id, name, description, duration, price, color, category)
SELECT 2, 'Quick Service', 'Short appointment', 30, 30, '#10b981', 'General'
WHERE NOT EXISTS (SELECT 1 FROM _meta WHERE key = 'seed_demo_data' AND value = '1');
INSERT INTO services (id, name, description, duration, price, color, category)
SELECT 3, 'Premium Session', 'Extended premium service', 90, 85, '#8b5cf6', 'Premium'
WHERE NOT EXISTS (SELECT 1 FROM _meta WHERE key = 'seed_demo_data' AND value = '1');
INSERT INTO services (id, name, description, duration, price, color, category)
SELECT 4, 'Express Touch-up', 'Quick 15-minute service', 15, 20, '#f59e0b', 'Express'
WHERE NOT EXISTS (SELECT 1 FROM _meta WHERE key = 'seed_demo_data' AND value = '1');
INSERT INTO services (id, name, description, duration, price, color, category)
SELECT 5, 'Consultation', 'Initial consultation', 30, 0, '#6b7280', 'General'
WHERE NOT EXISTS (SELECT 1 FROM _meta WHERE key = 'seed_demo_data' AND value = '1');
INSERT INTO services (id, name, description, duration, price, color, category)
SELECT 6, 'Package Deal', 'Multiple services bundled', 120, 120, '#ec4899', 'Premium'
WHERE NOT EXISTS (SELECT 1 FROM _meta WHERE key = 'seed_demo_data' AND value = '1');

-- Example clients
INSERT INTO clients (id, name, email, phone)
SELECT 1, 'Jamie Rivera', 'jamie@example.com', '555-0101'
WHERE NOT EXISTS (SELECT 1 FROM _meta WHERE key = 'seed_demo_data' AND value = '1');
INSERT INTO clients (id, name, email, phone)
SELECT 2, 'Casey Morgan', 'casey@example.com', '555-0102'
WHERE NOT EXISTS (SELECT 1 FROM _meta WHERE key = 'seed_demo_data' AND value = '1');
INSERT INTO clients (id, name, email, phone)
SELECT 3, 'Riley Chen', 'riley@example.com', '555-0103'
WHERE NOT EXISTS (SELECT 1 FROM _meta WHERE key = 'seed_demo_data' AND value = '1');
INSERT INTO clients (id, name, email, phone)
SELECT 4, 'Dakota Smith', 'dakota@example.com', '555-0104'
WHERE NOT EXISTS (SELECT 1 FROM _meta WHERE key = 'seed_demo_data' AND value = '1');

-- Example products
INSERT INTO products (id, name, brand, category, price, cost, stock)
SELECT 1, 'Professional Shampoo', 'ProCare', 'Hair Care', 24.99, 12.00, 25
WHERE NOT EXISTS (SELECT 1 FROM _meta WHERE key = 'seed_demo_data' AND value = '1');
INSERT INTO products (id, name, brand, category, price, cost, stock)
SELECT 2, 'Styling Gel', 'ProCare', 'Styling', 15.99, 7.50, 40
WHERE NOT EXISTS (SELECT 1 FROM _meta WHERE key = 'seed_demo_data' AND value = '1');
INSERT INTO products (id, name, brand, category, price, cost, stock)
SELECT 3, 'Moisturizing Cream', 'SkinLux', 'Skin Care', 32.99, 16.00, 18
WHERE NOT EXISTS (SELECT 1 FROM _meta WHERE key = 'seed_demo_data' AND value = '1');
INSERT INTO products (id, name, brand, category, price, cost, stock)
SELECT 4, 'Essential Oil Set', 'AromaPlus', 'Wellness', 45.99, 22.00, 12
WHERE NOT EXISTS (SELECT 1 FROM _meta WHERE key = 'seed_demo_data' AND value = '1');

INSERT OR IGNORE INTO _meta (key, value) VALUES ('seed_demo_data', '1');

-- Indexes
CREATE INDEX IF NOT EXISTS idx_appointments_client ON appointments(client_id);
CREATE INDEX IF NOT EXISTS idx_appointments_staff ON appointments(staff_id);
CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);
CREATE INDEX IF NOT EXISTS idx_appointment_services_apt ON appointment_services(appointment_id);
CREATE INDEX IF NOT EXISTS idx_appointment_notes_apt ON appointment_notes(appointment_id);
CREATE INDEX IF NOT EXISTS idx_blocked_slots_staff ON blocked_slots(staff_id);
CREATE INDEX IF NOT EXISTS idx_blocked_slots_date ON blocked_slots(blocked_date);
CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_services_category ON services(category);
CREATE INDEX IF NOT EXISTS idx_booking_links_token ON booking_links(token);
CREATE INDEX IF NOT EXISTS idx_booking_links_status ON booking_links(status);

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

CREATE TABLE IF NOT EXISTS notification_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  channel TEXT NOT NULL,
  recipient TEXT NOT NULL,
  template TEXT NOT NULL,
  status TEXT NOT NULL,
  provider_id TEXT,
  error_message TEXT NOT NULL DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notification_log_appointment ON notification_log(appointment_id);
CREATE INDEX IF NOT EXISTS idx_notification_log_created ON notification_log(created_at);

-- Seasonal bookable offerings (B1)
CREATE TABLE IF NOT EXISTS offerings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  detailed_description TEXT NOT NULL DEFAULT '',
  base_price REAL NOT NULL DEFAULT 0,
  duration INTEGER NOT NULL DEFAULT 60,
  color TEXT NOT NULL DEFAULT '#ec4899',
  category TEXT NOT NULL DEFAULT 'Seasonal',
  status TEXT NOT NULL DEFAULT 'draft',
  capacity_per_slot INTEGER NOT NULL DEFAULT 1,
  block_regular_bookings INTEGER,
  staff_ids TEXT NOT NULL DEFAULT '[]',
  currency TEXT NOT NULL DEFAULT 'USD',
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

CREATE INDEX IF NOT EXISTS idx_appointments_offering_slot ON appointments(offering_slot_instance_id);

-- One-time for DBs created before B1 (skip if column already exists):
-- ALTER TABLE appointments ADD COLUMN offering_slot_instance_id INTEGER REFERENCES offering_slot_instances(id);

-- One-time for DBs created before A1 (skip if column already exists):
-- ALTER TABLE clients ADD COLUMN address TEXT DEFAULT '';
