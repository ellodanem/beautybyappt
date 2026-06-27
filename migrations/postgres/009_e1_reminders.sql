-- E1: Email reminders 24h and 2h before appointment

ALTER TABLE appointments ADD COLUMN reminder_24h_sent_at TEXT;
ALTER TABLE appointments ADD COLUMN reminder_2h_sent_at TEXT;

INSERT INTO _meta (key, value) VALUES ('remind_24h_enabled', '1') ON CONFLICT (key) DO NOTHING;
INSERT INTO _meta (key, value) VALUES ('remind_2h_enabled', '1') ON CONFLICT (key) DO NOTHING;
INSERT INTO _meta (key, value) VALUES ('business_utc_offset', '-4') ON CONFLICT (key) DO NOTHING;
