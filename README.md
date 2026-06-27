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

Preact · Tailwind CSS v4 · shadcn/ui · Hono · Cloudflare D1 (SQLite locally)

## Attribution

This project is based on [Open Salon](https://github.com/clawnify/open-salon) by Clawnify. See [NOTICE.md](./NOTICE.md) for details.

## License

MIT License — see [LICENSE](./LICENSE).

Copyright (c) 2026 Clawnify (original work)

Modifications copyright (c) 2026 Beauty By Appointment contributors
