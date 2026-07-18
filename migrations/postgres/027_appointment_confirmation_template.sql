INSERT INTO email_templates (slug, name, subject, body, is_builtin)
VALUES (
  'appointment_confirmation',
  'Appointment confirmation',
  'Appointment confirmed — {reference}',
  E'Hi {client_name},\n\nYour appointment with {business_name} is confirmed.\n\nReference: {reference}\nDate: {date}\nTime: {time}\n{event_name}\n{services}\n{location}\n\nTotal: {total}\nAmount paid: {amount_paid}\nBalance due: {balance_due}\n\n{payment_link}\n\nWe look forward to seeing you.\n\n— {business_name}',
  1
) ON CONFLICT (slug) DO NOTHING;
