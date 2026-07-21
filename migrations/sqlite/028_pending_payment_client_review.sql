-- Require staff review of payer → client before applying open credits
ALTER TABLE pending_payments ADD COLUMN client_reviewed_at TEXT;
