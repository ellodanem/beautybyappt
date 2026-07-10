-- Allow one-time custom services and store a name snapshot on each line item.
-- SQLite cannot DROP NOT NULL in place; rebuild appointment_services.

CREATE TABLE IF NOT EXISTS appointment_services_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  service_id INTEGER REFERENCES services(id) ON DELETE CASCADE,
  service_name TEXT NOT NULL DEFAULT '',
  price REAL NOT NULL DEFAULT 0,
  duration INTEGER NOT NULL DEFAULT 60
);

INSERT INTO appointment_services_new (id, appointment_id, service_id, service_name, price, duration)
SELECT
  aps.id,
  aps.appointment_id,
  aps.service_id,
  COALESCE(sv.name, ''),
  aps.price,
  aps.duration
FROM appointment_services aps
LEFT JOIN services sv ON sv.id = aps.service_id;

DROP TABLE appointment_services;
ALTER TABLE appointment_services_new RENAME TO appointment_services;

CREATE INDEX IF NOT EXISTS idx_appointment_services_apt ON appointment_services(appointment_id);
