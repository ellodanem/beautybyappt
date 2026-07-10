-- Feature F: Google Calendar sync (salon-wide)
ALTER TABLE appointments ADD COLUMN google_event_id TEXT;
ALTER TABLE blocked_slots ADD COLUMN google_event_id TEXT;

INSERT OR IGNORE INTO _meta (key, value) VALUES ('gcal_refresh_token_enc', '');
INSERT OR IGNORE INTO _meta (key, value) VALUES ('gcal_address', '');
INSERT OR IGNORE INTO _meta (key, value) VALUES ('gcal_calendar_id', 'primary');
