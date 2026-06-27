-- Short + detailed descriptions for special events

ALTER TABLE offerings ADD COLUMN IF NOT EXISTS detailed_description TEXT NOT NULL DEFAULT '';
