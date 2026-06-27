-- Full PostgreSQL schema for fresh Neon installs (Beauty By Appointment).
-- Run once on a new database, then optional incremental files in this folder are no-ops.

CREATE TABLE IF NOT EXISTS clients (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (NOW()::text),
  updated_at TEXT NOT NULL DEFAULT (NOW()::text)
);

CREATE TABLE IF NOT EXISTS staff (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#7c3aed',
  active INTEGER NOT NULL DEFAULT 1,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (NOW()::text)
);

CREATE TABLE IF NOT EXISTS services (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  duration INTEGER NOT NULL DEFAULT 60,
  price DOUBLE PRECISION NOT NULL DEFAULT 0,
  color TEXT NOT NULL DEFAULT '#6b7280',
  category TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (NOW()::text)
);

CREATE TABLE IF NOT EXISTS appointments (
  id BIGSERIAL PRIMARY KEY,
  identifier TEXT NOT NULL UNIQUE,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  staff_id BIGINT REFERENCES staff(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'booked',
  scheduled_date TEXT NOT NULL DEFAULT (CURRENT_DATE::text),
  start_time TEXT NOT NULL DEFAULT '09:00',
  end_time TEXT NOT NULL DEFAULT '10:00',
  total_price DOUBLE PRECISION NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  deposit_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  amount_paid DOUBLE PRECISION NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'unpaid',
  stripe_checkout_session_id TEXT,
  stripe_payment_intent_id TEXT,
  travel_fee DOUBLE PRECISION NOT NULL DEFAULT 0,
  service_address TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  is_recurring INTEGER NOT NULL DEFAULT 0,
  recurrence_interval TEXT NOT NULL DEFAULT '',
  offering_slot_instance_id BIGINT,
  reminder_24h_sent_at TEXT,
  reminder_2h_sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (NOW()::text),
  updated_at TEXT NOT NULL DEFAULT (NOW()::text)
);

CREATE TABLE IF NOT EXISTS appointment_services (
  id BIGSERIAL PRIMARY KEY,
  appointment_id BIGINT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  service_id BIGINT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  price DOUBLE PRECISION NOT NULL DEFAULT 0,
  duration INTEGER NOT NULL DEFAULT 60
);

CREATE TABLE IF NOT EXISTS appointment_notes (
  id BIGSERIAL PRIMARY KEY,
  appointment_id BIGINT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (NOW()::text)
);

CREATE TABLE IF NOT EXISTS blocked_slots (
  id BIGSERIAL PRIMARY KEY,
  staff_id BIGINT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  blocked_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (NOW()::text)
);

CREATE TABLE IF NOT EXISTS products (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  brand TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  sku TEXT NOT NULL DEFAULT '',
  price DOUBLE PRECISION NOT NULL DEFAULT 0,
  cost DOUBLE PRECISION NOT NULL DEFAULT 0,
  stock INTEGER NOT NULL DEFAULT 0,
  low_stock_alert INTEGER NOT NULL DEFAULT 5,
  created_at TEXT NOT NULL DEFAULT (NOW()::text),
  updated_at TEXT NOT NULL DEFAULT (NOW()::text)
);

CREATE TABLE IF NOT EXISTS _meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO _meta (key, value) VALUES ('appointment_counter', '0') ON CONFLICT (key) DO NOTHING;
INSERT INTO _meta (key, value) VALUES ('appointment_prefix', 'APT') ON CONFLICT (key) DO NOTHING;
INSERT INTO _meta (key, value) VALUES ('default_currency', 'USD') ON CONFLICT (key) DO NOTHING;
INSERT INTO _meta (key, value) VALUES ('business_name', '') ON CONFLICT (key) DO NOTHING;
INSERT INTO _meta (key, value) VALUES ('business_tagline', '') ON CONFLICT (key) DO NOTHING;
INSERT INTO _meta (key, value) VALUES ('logo_url', '') ON CONFLICT (key) DO NOTHING;
INSERT INTO _meta (key, value) VALUES ('block_regular_on_event_days', '1') ON CONFLICT (key) DO NOTHING;
INSERT INTO _meta (key, value) VALUES ('notify_email_enabled', '1') ON CONFLICT (key) DO NOTHING;
INSERT INTO _meta (key, value) VALUES ('notify_sms_enabled', '0') ON CONFLICT (key) DO NOTHING;
INSERT INTO _meta (key, value) VALUES ('notify_whatsapp_enabled', '0') ON CONFLICT (key) DO NOTHING;
INSERT INTO _meta (key, value) VALUES ('email_reply_to', '') ON CONFLICT (key) DO NOTHING;
INSERT INTO _meta (key, value) VALUES ('remind_24h_enabled', '1') ON CONFLICT (key) DO NOTHING;
INSERT INTO _meta (key, value) VALUES ('remind_2h_enabled', '1') ON CONFLICT (key) DO NOTHING;
INSERT INTO _meta (key, value) VALUES ('stripe_payments_enabled', '0') ON CONFLICT (key) DO NOTHING;
INSERT INTO _meta (key, value) VALUES ('business_utc_offset', '-4') ON CONFLICT (key) DO NOTHING;
INSERT INTO _meta (key, value) VALUES ('business_country', 'LC') ON CONFLICT (key) DO NOTHING;
INSERT INTO _meta (key, value) VALUES ('business_timezone', 'America/St_Lucia') ON CONFLICT (key) DO NOTHING;
INSERT INTO _meta (key, value) VALUES ('email_domain', '') ON CONFLICT (key) DO NOTHING;
INSERT INTO _meta (key, value) VALUES ('resend_domain_id', '') ON CONFLICT (key) DO NOTHING;
INSERT INTO _meta (key, value) VALUES ('email_domain_status', '') ON CONFLICT (key) DO NOTHING;
INSERT INTO _meta (key, value) VALUES ('email_domain_records', '[]') ON CONFLICT (key) DO NOTHING;
INSERT INTO _meta (key, value) VALUES ('email_from_address', '') ON CONFLICT (key) DO NOTHING;
INSERT INTO _meta (key, value) VALUES ('subscription_plan', 'free') ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS booking_links (
  id BIGSERIAL PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  staff_id BIGINT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  scheduled_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  total_price DOUBLE PRECISION NOT NULL DEFAULT 0,
  deposit_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  notes TEXT NOT NULL DEFAULT '',
  service_ids TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at TEXT,
  appointment_id BIGINT REFERENCES appointments(id) ON DELETE SET NULL,
  client_id BIGINT REFERENCES clients(id) ON DELETE SET NULL,
  stripe_checkout_session_id TEXT,
  travel_fee DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (NOW()::text),
  confirmed_at TEXT
);

CREATE TABLE IF NOT EXISTS payments (
  id BIGSERIAL PRIMARY KEY,
  appointment_id BIGINT REFERENCES appointments(id) ON DELETE SET NULL,
  booking_link_id BIGINT REFERENCES booking_links(id) ON DELETE SET NULL,
  stripe_checkout_session_id TEXT,
  stripe_payment_intent_id TEXT,
  amount DOUBLE PRECISION NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (NOW()::text)
);

CREATE TABLE IF NOT EXISTS notification_log (
  id BIGSERIAL PRIMARY KEY,
  appointment_id BIGINT REFERENCES appointments(id) ON DELETE SET NULL,
  channel TEXT NOT NULL,
  recipient TEXT NOT NULL,
  template TEXT NOT NULL,
  status TEXT NOT NULL,
  provider_id TEXT,
  error_message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (NOW()::text)
);

CREATE TABLE IF NOT EXISTS offerings (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  detailed_description TEXT NOT NULL DEFAULT '',
  base_price DOUBLE PRECISION NOT NULL DEFAULT 0,
  duration INTEGER NOT NULL DEFAULT 60,
  color TEXT NOT NULL DEFAULT '#ec4899',
  category TEXT NOT NULL DEFAULT 'Seasonal',
  status TEXT NOT NULL DEFAULT 'draft',
  capacity_per_slot INTEGER NOT NULL DEFAULT 1,
  block_regular_bookings INTEGER,
  staff_ids TEXT NOT NULL DEFAULT '[]',
  currency TEXT NOT NULL DEFAULT 'USD',
  created_at TEXT NOT NULL DEFAULT (NOW()::text),
  updated_at TEXT NOT NULL DEFAULT (NOW()::text)
);

CREATE TABLE IF NOT EXISTS offering_date_windows (
  id BIGSERIAL PRIMARY KEY,
  offering_id BIGINT NOT NULL REFERENCES offerings(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL
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
  price DOUBLE PRECISION NOT NULL DEFAULT 0,
  extra_duration INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS offering_slot_instances (
  id BIGSERIAL PRIMARY KEY,
  offering_id BIGINT NOT NULL REFERENCES offerings(id) ON DELETE CASCADE,
  slot_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 1,
  booked_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE (offering_id, slot_date, start_time)
);

CREATE TABLE IF NOT EXISTS appointment_offering_addons (
  id BIGSERIAL PRIMARY KEY,
  appointment_id BIGINT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  offering_addon_id BIGINT NOT NULL REFERENCES offering_addons(id),
  price DOUBLE PRECISION NOT NULL DEFAULT 0
);

ALTER TABLE appointments
  DROP CONSTRAINT IF EXISTS appointments_offering_slot_instance_id_fkey;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'appointments_offering_slot_instance_id_fkey'
  ) THEN
    ALTER TABLE appointments
      ADD CONSTRAINT appointments_offering_slot_instance_id_fkey
      FOREIGN KEY (offering_slot_instance_id) REFERENCES offering_slot_instances(id);
  END IF;
END $$;

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
CREATE INDEX IF NOT EXISTS idx_payments_appointment ON payments(appointment_id);
CREATE INDEX IF NOT EXISTS idx_payments_booking_link ON payments(booking_link_id);
CREATE INDEX IF NOT EXISTS idx_payments_stripe_session ON payments(stripe_checkout_session_id);
CREATE INDEX IF NOT EXISTS idx_notification_log_appointment ON notification_log(appointment_id);
CREATE INDEX IF NOT EXISTS idx_notification_log_created ON notification_log(created_at);
CREATE INDEX IF NOT EXISTS idx_offerings_status ON offerings(status);
CREATE INDEX IF NOT EXISTS idx_offering_date_windows_offering ON offering_date_windows(offering_id);
CREATE INDEX IF NOT EXISTS idx_offering_slot_instances_date ON offering_slot_instances(slot_date);
CREATE INDEX IF NOT EXISTS idx_appointments_offering_slot ON appointments(offering_slot_instance_id);
