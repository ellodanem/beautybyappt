-- G1: Manual travel fee on booking links and appointments

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS travel_fee DECIMAL(10, 2) NOT NULL DEFAULT 0;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS service_address TEXT NOT NULL DEFAULT '';

ALTER TABLE booking_links ADD COLUMN IF NOT EXISTS travel_fee DECIMAL(10, 2) NOT NULL DEFAULT 0;
