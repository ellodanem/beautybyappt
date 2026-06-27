# Beauty By Appointment

Booking and business management for makeup artists and beauty professionals. Share a link, take bookings, collect payments, and run your calendar from your phone.

Built for artists like Beauty By Keris — mobile-first, social-ready, and designed for the way beauty pros actually work.

## Features

- **Day calendar** — staff columns, colored blocks, blocked time
- **Booking links** — public pages clients book from Instagram, WhatsApp, or QR codes
- **Offerings** — anytime services and event-based slots with capacity
- **Stripe payments** — deposits, balances, and close-out tracking
- **Client management** — contact info, notes, appointment history
- **Branding** — your logo, business name, and tagline on every client-facing page
- **Email notifications** — confirmations and reminders via Resend
- **Settings** — currency, travel fees, email domain, Stripe toggle

## Quickstart

```bash
git clone https://github.com/ellodanem/beautybyappt.git
cd beautybyappt
pnpm install
cp .dev.vars.example .dev.vars   # add Stripe / Resend keys
pnpm run dev
```

Open `http://localhost:5173` in your browser.

## Tech Stack

Preact · Tailwind CSS v4 · shadcn/ui · Hono · Neon (PostgreSQL) on Vercel · Cloudflare D1 for local dev

## Deploy (Vercel + Neon)

1. Create a [Neon](https://neon.tech) project and copy the connection string.
2. Run migrations: `DATABASE_URL="postgresql://…" pnpm run db:migrate`
3. Import the repo at [vercel.com](https://vercel.com) and set environment variables:
   - `DATABASE_URL` — Neon connection string
   - `APP_URL` — your Vercel URL (e.g. `https://beautybyappt.vercel.app`)
   - `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
   - `RESEND_API_KEY`, `EMAIL_FROM`
   - `CRON_SECRET` — random string (Vercel Cron sends `Authorization: Bearer …`)
   - `ADMIN_PASSWORD` — staff login password for the admin UI
   - `SESSION_SECRET` — random string used to sign session cookies (can differ from `ADMIN_PASSWORD`)
4. Deploy. Point Stripe webhooks to `https://your-domain/api/stripe/webhook`.

Local dev still uses Wrangler + D1 (`pnpm dev`). No PC needs to stay on — Vercel and Neon run in the cloud.

## Attribution

This project is based on [Open Salon](https://github.com/clawnify/open-salon) by Clawnify. See [NOTICE.md](./NOTICE.md) for details.

## License

MIT License — see [LICENSE](./LICENSE).

Copyright (c) 2026 Clawnify (original work)

Modifications copyright (c) 2026 Beauty By Appointment contributors
