-- Require staff review of payer → client before applying open credits
ALTER TABLE pending_payments ADD COLUMN IF NOT EXISTS client_reviewed_at TIMESTAMPTZ;
