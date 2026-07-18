INSERT OR IGNORE INTO email_templates (slug, name, subject, body, is_builtin)
VALUES (
  'appointment_confirmation',
  'Appointment confirmation',
  'Appointment confirmed — {reference}',
  'Hi {client_name},

Your appointment with {business_name} is confirmed.

Reference: {reference}
Date: {date}
Time: {time}
{event_name}
{services}
{location}

Total: {total}
Amount paid: {amount_paid}
Balance due: {balance_due}

{payment_link}

We look forward to seeing you.

— {business_name}',
  1
);
