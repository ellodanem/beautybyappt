ALTER TABLE payments ADD COLUMN link_token TEXT;
CREATE INDEX IF NOT EXISTS idx_payments_link_token ON payments(link_token);
