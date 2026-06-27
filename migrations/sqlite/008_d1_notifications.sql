-- D1: Booking confirmation notifications (email, SMS/WhatsApp placeholders)

CREATE TABLE IF NOT EXISTS notification_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  channel TEXT NOT NULL,
  recipient TEXT NOT NULL,
  template TEXT NOT NULL,
  status TEXT NOT NULL,
  provider_id TEXT,
  error_message TEXT NOT NULL DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notification_log_appointment ON notification_log(appointment_id);
CREATE INDEX IF NOT EXISTS idx_notification_log_created ON notification_log(created_at);

INSERT OR IGNORE INTO _meta (key, value) VALUES ('notify_email_enabled', '1');
INSERT OR IGNORE INTO _meta (key, value) VALUES ('notify_sms_enabled', '0');
INSERT OR IGNORE INTO _meta (key, value) VALUES ('notify_whatsapp_enabled', '0');
INSERT OR IGNORE INTO _meta (key, value) VALUES ('email_reply_to', '');
