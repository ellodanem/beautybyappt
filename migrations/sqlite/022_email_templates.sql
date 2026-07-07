CREATE TABLE IF NOT EXISTS email_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  is_builtin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO email_templates (slug, name, subject, body, is_builtin)
VALUES (
  'payment_reminder',
  'Payment reminder',
  'Payment reminder — {reference}',
  'Hi {client_name},

This is a friendly reminder that you have a balance of {balance_due} due for your appointment with {business_name}.

Reference: {reference}
Date: {date}
Time: {time}
Total: {total}
Amount paid: {amount_paid}
Balance due: {balance_due}

{payment_link}

Please let us know if you have any questions.

— {business_name}',
  1
);
