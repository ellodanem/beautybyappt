-- Feature F: Google Calendar sync (salon-wide)
ALTER TABLE appointments ADD COLUMN google_event_id TEXT;
ALTER TABLE blocked_slots ADD COLUMN google_event_id TEXT;

INSERT INTO _meta (key, value) VALUES ('gcal_refresh_token_enc', '') ON CONFLICT (key) DO NOTHING;
INSERT INTO _meta (key, value) VALUES ('gcal_address', '') ON CONFLICT (key) DO NOTHING;
INSERT INTO _meta (key, value) VALUES ('gcal_calendar_id', 'primary') ON CONFLICT (key) DO NOTHING;
