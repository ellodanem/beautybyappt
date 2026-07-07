CREATE TABLE IF NOT EXISTS notification_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  offering_id INTEGER REFERENCES offerings(id) ON DELETE CASCADE,
  email_template_id INTEGER NOT NULL REFERENCES email_templates(id),
  hours_before INTEGER NOT NULL,
  channel TEXT NOT NULL DEFAULT 'email',
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS appointment_notification_sent (
  appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  rule_id INTEGER NOT NULL REFERENCES notification_rules(id) ON DELETE CASCADE,
  sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (appointment_id, rule_id)
);

CREATE INDEX IF NOT EXISTS idx_notification_rules_offering ON notification_rules(offering_id);
CREATE INDEX IF NOT EXISTS idx_appointment_notification_sent_appointment ON appointment_notification_sent(appointment_id);
