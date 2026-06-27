-- Short + detailed descriptions for special events

ALTER TABLE offerings ADD COLUMN detailed_description TEXT NOT NULL DEFAULT '';
