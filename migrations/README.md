# Database migrations

Portable schema for **local D1 (SQLite)** today and **Neon (PostgreSQL)** on Vercel/cloud later.

## Layout

| Path | Engine | Use |
|------|--------|-----|
| `sqlite/` | SQLite / D1 | Applied via `src/server/schema.sql` on `pnpm dev` (keep in sync) |
| `postgres/` | PostgreSQL / Neon | Run against Neon when deploying to Vercel |

## Conventions (Postgres / Neon friendly)

- Table names: `snake_case`, plural nouns
- Primary keys: `BIGSERIAL` (Postgres) / `INTEGER` (SQLite)
- Timestamps: `TIMESTAMPTZ` + `NOW()` (Postgres) / `TEXT` + `datetime('now')` (SQLite)
- Money: `DECIMAL(10,2)` (Postgres) / `REAL` (SQLite)
- Status fields: `TEXT` with documented enum values in MVP doc
- JSON arrays: `JSONB` (Postgres) / `TEXT` with JSON string (SQLite)
- Avoid engine-specific functions in shared business logic

## Applying

**Local (D1):** `pnpm dev` runs `wrangler d1 execute ... --file=src/server/schema.sql`

**Neon:** run files in `postgres/` in order, e.g.:

```bash
psql "$DATABASE_URL" -f migrations/postgres/001_a1_booking_links.sql
```

## Migration log

| File | Description |
|------|-------------|
| `000_base_schema` | Full PostgreSQL schema for fresh Neon installs |
| `001_a1_booking_links` | `clients.address`, `booking_links` table |
| `002_currency` | `default_currency` setting, `currency` on links & appointments |
| `003_h1_branding` | `business_name`, `business_tagline`, `logo_url` in `_meta` |
| `004_b1_offerings` | Offerings tables, slot instances, appointment link |
| `005_event_override` | `block_regular_on_event_days` default + per-offering override |
| `006_service_slugs` | `slug` on `services` for public anytime booking links |
| `006_c1_stripe` | Payment columns on appointments, `payments` table, Stripe session on links |
| `007_g1_travel_fee` | `travel_fee`, `service_address` on appointments; `travel_fee` on booking links |
| `008_d1_notifications` | `notification_log` table; notification channel settings in `_meta` |
| `009_e1_reminders` | `reminder_24h_sent_at`, `reminder_2h_sent_at`; reminder toggles in `_meta` |
| `010_email_domain` | Resend domain connect settings in `_meta` (`email_domain`, `email_from_address`, etc.) |
| `011_offering_currency` | `currency` on `offerings` (per-event pricing currency) |
