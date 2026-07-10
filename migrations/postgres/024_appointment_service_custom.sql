-- Allow one-time custom services and store a name snapshot on each line item.
ALTER TABLE appointment_services ALTER COLUMN service_id DROP NOT NULL;
ALTER TABLE appointment_services ADD COLUMN IF NOT EXISTS service_name TEXT NOT NULL DEFAULT '';

UPDATE appointment_services aps
SET service_name = sv.name
FROM services sv
WHERE aps.service_id = sv.id
  AND (aps.service_name IS NULL OR aps.service_name = '');
