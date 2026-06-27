-- B1.1: Event days block regular bookings (global default + per-offering override)

INSERT OR IGNORE INTO _meta (key, value) VALUES ('block_regular_on_event_days', '1');

ALTER TABLE offerings ADD COLUMN block_regular_bookings INTEGER;
