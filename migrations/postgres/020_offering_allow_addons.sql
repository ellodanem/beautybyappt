-- Allow toggling extras on/off per special event offering
ALTER TABLE offerings ADD COLUMN IF NOT EXISTS allow_addons INTEGER NOT NULL DEFAULT 1;
