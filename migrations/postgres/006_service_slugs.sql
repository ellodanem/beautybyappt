-- Service slugs for public anytime booking links

ALTER TABLE services ADD COLUMN IF NOT EXISTS slug TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_services_slug ON services(slug);
