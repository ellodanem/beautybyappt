-- G1: Manual travel fee on booking links and appointments

ALTER TABLE appointments ADD COLUMN travel_fee REAL NOT NULL DEFAULT 0;
ALTER TABLE appointments ADD COLUMN service_address TEXT NOT NULL DEFAULT '';

ALTER TABLE booking_links ADD COLUMN travel_fee REAL NOT NULL DEFAULT 0;
