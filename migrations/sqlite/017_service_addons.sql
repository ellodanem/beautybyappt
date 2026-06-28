-- Service add-ons for anytime services

ALTER TABLE services ADD COLUMN allow_addons INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS service_addons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price REAL NOT NULL DEFAULT 0,
  extra_duration INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS appointment_service_addons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  service_addon_id INTEGER NOT NULL REFERENCES service_addons(id),
  price REAL NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_service_addons_service ON service_addons(service_id);
CREATE INDEX IF NOT EXISTS idx_appointment_service_addons_appointment ON appointment_service_addons(appointment_id);
