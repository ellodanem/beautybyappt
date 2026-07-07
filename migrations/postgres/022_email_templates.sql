CREATE TABLE IF NOT EXISTS email_templates (
  id SERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  is_builtin INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO email_templates (slug, name, subject, body, is_builtin)
VALUES (
  'payment_reminder',
  'Payment reminder',
  'Payment reminder — {reference}',
  E'Hi {client_name},\n\nThis is a friendly reminder that you have a balance of {balance_due} due for your appointment with {business_name}.\n\nReference: {reference}\nDate: {date}\nTime: {time}\nTotal: {total}\nAmount paid: {amount_paid}\nBalance due: {balance_due}\n\n{payment_link}\n\nPlease let us know if you have any questions.\n\n— {business_name}',
  1
) ON CONFLICT (slug) DO NOTHING;
