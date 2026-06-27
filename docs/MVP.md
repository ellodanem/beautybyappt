# Beauty By Appointment — MVP Roadmap

Living document for features discussed while building Beauty By Appointment (originally forked from Open Salon).

**Last updated:** 2026-06-26

### A1 implementation status

**In progress / shipped locally:**

- [x] `booking_links` table + `clients.address` (SQLite schema + `migrations/postgres/` for Neon)
- [x] API: `POST /api/booking-links`, `GET /api/book/public/:token`, `POST /api/book/public/:token/confirm`
- [x] Staff UI: **Booking link** on calendar → create, copy, WhatsApp share
- [x] Public mobile page: `/book/:token`
- [x] 48h link expiry (independent of Stripe — see note below)
- [x] Global default currency + per-link currency override (Settings + booking link dialog)
- [ ] Auth on staff API (deferred — minimal for local dev)

### A1 product decisions (locked)

| Decision | Choice |
|----------|--------|
| First slice | **A1** custom booking link |
| Client address | **Optional** |
| Link expiry | **48 hours** |
| Currency | **USD default**; global setting + per-link override (USD, XCD, EUR, GBP, CAD) |
| Hosting | **Local dev** now → Vercel + Neon later |
| DB migrations | `migrations/postgres/` (Neon) + `schema.sql` (local D1) |

**Note:** Link expiry (48h) is separate from Stripe checkout timeout. The shareable link must be used within 48h; when Stripe is added (C1), checkout may have its own shorter hold (e.g. 15 min) while paying.

---

## Overview

| Feature | Best for | Pattern |
|---------|----------|---------|
| **A. Custom booking link** | One-off exceptions (off-hours, special client) | Staff hand-picks slot → share link → client confirms |
| **B. Seasonal bookable offerings** | Planned events (Carnival, holiday pop-ups) | Configure once → slots on calendar → many clients book |
| **C. Stripe integration** | Deposits, full payment, travel fees | Pay at confirm / checkout; webhooks update booking status |
| **D. Email** | Confirmations, receipts, staff alerts | Transactional email on key events |
| **E. Reminders** | Reduce no-shows | Scheduled nudge before appointment (email; SMS later) |
| **F. Google Calendar sync** | Artists live in Google Calendar | Push appointments to staff Google Calendar |
| **G. Optional travel fee** | On-location / mobile makeup | Add distance-based or flat travel surcharge to booking |
| **H. Branding** | White-label client experience | Business name + logo on app, public pages, emails, checkout |

Features A and B should write to the same **appointment** records so the calendar stays one source of truth. C–H are cross-cutting capabilities that attach to appointments, links, and offerings.

Today Open Salon is **staff-only**: flat services (no seasonal windows, slots, or capacity), no public booking, no shareable links, no payments, no email, no reminders, no Google sync, no travel fees, no business branding settings, no `address` on clients. Staff UI shows generic **"Salon Manager"** in the sidebar (`sidebar.tsx`).

---

# Feature A — Custom booking link

## Problem statement

A client reaches out but no standard slots are available. The provider (e.g. makeup artist) is willing to work outside normal hours. Staff need to:

1. Quickly offer a specific date, time, and price
2. Share a link immediately (text, DM, email)
3. Let the client enter their own contact info and confirm
4. *(Later)* Collect a deposit via payment

## Target scenario

> Makeup artist gets a DM: *"Can you do 7am before the wedding?"*  
> Artist agrees to off-hours rate. Staff creates a link in ~30 seconds, sends it. Client opens on phone, fills name / phone / email / address, confirms. Appointment appears on the calendar.

**Key insight:** This is *not* full online scheduling. Staff hand-picks the slot. Off-hours is intentional, not a bug.

## Phases

### A1 — Custom booking link + client self-fill *(no payment)*

**Goal:** Replace manual back-and-forth. Staff sends link; client confirms; appointment is created.

| Area | Scope |
|------|--------|
| Staff UI | "Create booking link" — staff, date, time, services and/or custom price, optional note, expiry |
| Public page | `/book/:token` — show offer details + form |
| Client form | Name (required), phone (required), email (recommended), address (optional textarea) |
| On submit | Match or create client → create appointment → mark link used → confirmation screen |
| Calendar | Appointment visible like any other booking (`booked` or `confirmed`) |

**Out of scope for A1**

- Payment / deposits
- Client login
- Email/SMS notifications
- Availability engine (staff explicitly overrides schedule)

**Acceptance criteria**

- [ ] Staff can generate a link without selecting an existing client
- [ ] Link can be copied and opened in a browser without staff auth
- [ ] Client can submit the form and see a confirmation message
- [ ] Appointment appears on staff calendar with correct date, time, price, and client
- [ ] Link expires after configured time or first use
- [ ] Repeat clients matched by email or phone (no duplicate records when possible)

### A2 — Deposit payment

**Goal:** Client pays deposit when confirming; reduces no-shows. Uses **Feature C — Stripe**.

| Area | Scope |
|------|--------|
| Link fields | `deposit_amount`, payment status on link |
| Checkout | Stripe Checkout session created on confirm |
| Webhook | On success: confirm appointment, mark link `paid` |
| Staff UI | Show deposit status on appointment / link history |

See [Feature C — Stripe integration](#feature-c--stripe-integration) for full payment platform scope.

### A3 — Production hardening

**Goal:** Safe to expose on the public internet.

| Area | Scope |
|------|--------|
| Auth | Staff login; protect all `/api/*` and admin UI |
| Abuse | Rate limiting, CAPTCHA on public form |
| Conflict check | Warn or block if staff already booked at that time |
| Link management | List / revoke / resend links from staff UI |

## User flows (Feature A)

### Staff — create link (~30 sec)

1. Open **Create booking link** (from calendar, appointments, or sidebar)
2. Select staff member
3. Set date, start time, duration (or end time)
4. Set price (from services and/or custom amount)
5. Optional: note to client, expiry (default 48h)
6. **Copy link** → paste in text / Instagram DM / email

### Client — confirm (~1–2 min)

1. Open link on phone
2. See: date, time, staff name, services, total, staff note
3. Fill in: name, phone, email, address (if needed)
4. Tap **Confirm booking**
5. See confirmation screen with summary

### Payment addition (Feature C)

5. Redirect to Stripe for deposit  
6. On success → confirmation screen + receipt email (Feature D)

## Data model (Feature A)

### New table: `booking_links`

```sql
CREATE TABLE booking_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  staff_id INTEGER NOT NULL REFERENCES staff(id),
  scheduled_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  total_price REAL NOT NULL DEFAULT 0,
  deposit_amount REAL NOT NULL DEFAULT 0,
  notes TEXT DEFAULT '',              -- staff message shown to client
  service_ids TEXT DEFAULT '[]',      -- JSON array of service IDs, optional
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | confirmed | expired | cancelled
  expires_at TEXT,
  appointment_id INTEGER REFERENCES appointments(id),
  client_id INTEGER REFERENCES clients(id),
  created_at TEXT DEFAULT (datetime('now')),
  confirmed_at TEXT
);
```

### Extend `clients`

```sql
ALTER TABLE clients ADD COLUMN address TEXT DEFAULT '';
```

### Client matching on submit

1. Normalize phone (strip non-digits)
2. If email matches existing client → update phone/address if changed, reuse record
3. Else if phone matches → same
4. Else → insert new client

## API endpoints (Feature A)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/booking-links` | Staff | Create link, return `token` + full URL |
| `GET` | `/api/booking-links` | Staff | List links (optional v1.1) |
| `DELETE` | `/api/booking-links/:id` | Staff | Revoke / cancel link |
| `GET` | `/api/book/public/:token` | Public | Get offer details for display |
| `POST` | `/api/book/public/:token/confirm` | Public | Client info + create client + appointment |

A2: `POST /api/webhooks/stripe` (payment confirmation)

## Frontend routes (Feature A)

| Route | Audience | Purpose |
|-------|----------|---------|
| `/book/:token` | Public | Client-facing confirm page (minimal layout, no sidebar) |
| `/booking-links` or modal | Staff | Create and copy links |

---

# Feature B — Seasonal bookable offerings

## Problem statement

Seasonal services (e.g. St. Lucia Carnival makeup) are painful in typical booking apps. Setting up a service that is only bookable for Carnival Monday and Tuesday requires many disconnected steps: create service, restrict dates, define slots, set capacity, configure add-ons, block everything else.

**Root cause:** Carnival is not a flat "service" — it is a **time-boxed event product** with its own schedule, slots, and capacity.

## Target scenario

> **Carnival Beauty Hub 2026** — makeup for Carnival Monday & Tuesday (e.g. July 20–21).  
> Staff runs one wizard: name, two date windows, time slots (5am–12pm), 4 clients per slot, base price + add-ons (lashes, gems). **Save & Go Live.**  
> On those dates the calendar shows the offering with slot fill counts. Rest of the year it is dormant. Next year: duplicate offering, update dates.

**Key insight:** Configure once per season, set and forget until next year. Do not force this into the regular year-round service catalog.

## Concept: two layers

| Layer | Example | When |
|-------|---------|------|
| **Regular service** | Bridal trial, everyday glam | Year-round, staff calendar |
| **Bookable offering** | Carnival Beauty Hub 2026 | Seasonal, date-specific, slot-based |

Regular `services` table stays for everyday work. **Offerings** are a higher-level entity for seasonal/event booking.

## Phases

### B1 — Bookable offering (staff-only booking) ✅ *implemented locally*

**Goal:** One wizard creates a seasonal event; calendar shows slots on the right dates; staff books clients into slots manually.

| Area | Scope |
|------|--------|
| Wizard | Single flow: basics → dates → time slots → capacity → pricing → add-ons → go live |
| Availability | Specific date(s) / date range(s); multiple windows per offering |
| Time slots | Generated grid (start, end, interval) or manual times |
| Capacity | Max bookings per slot (e.g. 4 stations) |
| Add-ons | Optional extras with price (+ optional extra duration) |
| Go live | `draft` → `live`; materialize slot instances for each date × time |
| Calendar | On offering dates: **Event slots** column with fill counts (e.g. "3/4") |
| Archive | `completed` / `archived` status reserved; manual for now |

**Out of scope for B1** *(unchanged)*

- Public client self-booking (B2) — moved to B2 ✅
- Payment / deposits (C2)
- Clone-from-last-year (B3)

**Acceptance criteria**

- [x] Staff can create an offering in one wizard without touching blocked slots or manual calendar setup
- [x] Offering only appears on configured dates (dormant elsewhere)
- [x] Time slots generated correctly for each date window
- [x] Booking respects per-slot capacity (cannot overbook)
- [x] Add-ons adjust price (and duration if configured) on appointment
- [x] Appointments from offerings appear on main calendar alongside regular bookings

### B2 — Public booking for offerings ✅ *implemented locally*

**Goal:** Clients book Carnival (etc.) slots themselves from a landing page.

| Area | Scope |
|------|--------|
| Public page | `/offer/:slug` — pick date (if multi-day), slot, add-ons |
| Client form | Same as Feature A: name, phone, email, address |
| Capacity | Real-time slot availability; "slot full" when at capacity |
| Waitlist | Optional v2: join waitlist when full |

**Acceptance criteria**

- [x] Live offering has a shareable public URL (`/offer/:slug`)
- [x] Client can pick day, time slot, and add-ons without staff login
- [x] Full slots show as unavailable; booking fails if slot fills during checkout
- [x] Client match/create by email or phone; appointment appears on staff calendar
- [x] Staff can copy link or share via WhatsApp from Services list and event wizard

### B3 — Templates & year-over-year

**Goal:** Minimal work to relaunch next Carnival.

| Area | Scope |
|------|--------|
| Duplicate | "Copy Carnival Beauty Hub 2025 → 2026" |
| Presets | Reusable template: name pattern, slot grid, add-ons, capacity — only dates change |
| Carnival calendar | Optional: helper for Carnival Monday/Tuesday dates by year (St. Lucia) |

### B4 — Deposits & offering + link integration

| Area | Scope |
|------|--------|
| Deposits | Require deposit on public offering booking (uses Feature C — Stripe) |
| Custom link | Staff can still create one-off links (Feature A) for exceptions outside the grid |
| Monday vs Tuesday pricing | Optional day-specific rules within one offering |
| Travel fee | Optional travel surcharge on offering bookings (Feature G) |

## User flows (Feature B)

### Staff — create offering (~5 min, once per season)

1. **Basics** — Name (`Carnival Beauty Hub 2026`), description, category (`Seasonal / Carnival`), color, assigned staff
2. **When** — Availability: specific dates → `Jul 20, 2026` + `Jul 21, 2026` (add more windows if needed)
3. **Time slots** — Generate: 5:00 AM–12:00 PM, every 60 min — or enter custom times
4. **Capacity** — 4 bookings per slot (beauty hub stations) or 1 per assigned artist
5. **Pricing** — Base price; add-ons: Lashes +$25, Gems +$15, etc.
6. **Preview** — "28 slots across 2 days, 112 max bookings"
7. **Save & Go Live** — slots appear on calendar for those dates only

### Staff — book into offering slot

1. Open calendar on Carnival Monday
2. See offering slots with fill counts
3. Click open slot → book client (or share public link in B2)
4. Select add-ons → appointment created

### Client — public book (B2)

1. Open Carnival landing page
2. Pick day (Mon/Tue) and available slot
3. Select add-ons
4. Enter contact info → confirm (→ pay deposit when Feature C is live)

## Calendar behavior

| Date | What staff sees |
|------|-----------------|
| Outside offering windows | No offering UI (or sidebar badge: "Carnival 2026 — Jul 20–21") |
| Inside offering windows | Offering view: slots with capacity fill, color-coded |
| Mixed day | Regular staff appointments + offering slots coexist |

Prefer **slot grid overlay** or **offering column** on event dates rather than only staff columns — capacity is often per slot, not per person.

## Data model (Feature B)

### New tables

```sql
-- Seasonal / event bookable product
CREATE TABLE offerings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  description TEXT DEFAULT '',
  base_price REAL NOT NULL DEFAULT 0,
  duration INTEGER NOT NULL DEFAULT 60,   -- minutes per booking
  color TEXT NOT NULL DEFAULT '#ec4899',
  category TEXT DEFAULT 'Seasonal',
  status TEXT NOT NULL DEFAULT 'draft', -- draft | live | completed | archived
  capacity_per_slot INTEGER NOT NULL DEFAULT 1,
  staff_ids TEXT DEFAULT '[]',          -- JSON array; empty = any staff
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- When the offering is bookable (multiple windows per offering)
CREATE TABLE offering_date_windows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  offering_id INTEGER NOT NULL REFERENCES offerings(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL
);

-- Time slot template (applied to each day in a window)
CREATE TABLE offering_time_slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  offering_id INTEGER NOT NULL REFERENCES offerings(id) ON DELETE CASCADE,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL
);

-- Optional extras at booking time
CREATE TABLE offering_addons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  offering_id INTEGER NOT NULL REFERENCES offerings(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price REAL NOT NULL DEFAULT 0,
  extra_duration INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

-- Materialized slot instance (date + time + offering) for capacity tracking
CREATE TABLE offering_slot_instances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  offering_id INTEGER NOT NULL REFERENCES offerings(id) ON DELETE CASCADE,
  slot_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 1,
  booked_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(offering_id, slot_date, start_time)
);
```

### Extend `appointments`

```sql
ALTER TABLE appointments ADD COLUMN offering_slot_instance_id INTEGER
  REFERENCES offering_slot_instances(id);
```

### Appointment add-ons (junction)

```sql
CREATE TABLE appointment_offering_addons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  offering_addon_id INTEGER NOT NULL REFERENCES offering_addons(id),
  price REAL NOT NULL DEFAULT 0
);
```

### Go Live logic

On **Save & Go Live**:

1. Set `offerings.status = 'live'`
2. For each `offering_date_window`, expand each calendar day
3. For each day × each `offering_time_slot`, insert `offering_slot_instances` with capacity from offering
4. Calendar reads instances for the selected date

## API endpoints (Feature B)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/offerings` | Staff | Create offering (draft) |
| `PUT` | `/api/offerings/:id` | Staff | Update offering |
| `POST` | `/api/offerings/:id/go-live` | Staff | Materialize slots, set live |
| `POST` | `/api/offerings/:id/duplicate` | Staff | Clone for next year (B3) |
| `GET` | `/api/offerings` | Staff | List offerings |
| `GET` | `/api/offerings/:id` | Staff | Detail with windows, slots, add-ons |
| `GET` | `/api/offerings/calendar` | Staff | Slot instances for date range |
| `POST` | `/api/offerings/slots/:id/book` | Staff | Book client into slot (+ add-ons) |
| `GET` | `/api/offer/public/:slug` | Public | Offering + availability (B2) |
| `POST` | `/api/offer/public/:slug/book` | Public | Client books slot (B2) |

## Frontend routes (Feature B)

| Route | Audience | Purpose |
|-------|----------|---------|
| `/offerings` | Staff | List offerings (draft / live / archived) |
| `/offerings/new` | Staff | Creation wizard |
| `/offerings/:id` | Staff | Edit / preview / go live |
| `/calendar` | Staff | Enhanced: offering slots on event dates |
| `/offer/:slug` | Public | Client booking page (B2) |

## Carnival-specific notes

- **Name by year** (`Carnival Beauty Hub 2026`), not by weekday — parade dates shift annually
- **St. Lucia Carnival** Monday/Tuesday fall on different calendar dates each year; B3 template should only require date updates
- **Separate Mon/Tue pricing** optional in B4 (parade day premium)
- **Deposits strongly recommended** for seasonal slots — use Feature C (Stripe)
- **Auto-archive** after last window ends

## Open questions (Feature B)

- [ ] Capacity model: per slot (stations) vs per staff member vs both?
- [ ] One offering per event, or separate offerings for Monday vs Tuesday?
- [ ] Public slug: auto from name or staff-edited?
- [ ] Waitlist when slot full?
- [x] Can regular services be booked on same days as an offering? → **Default: no** when event is live (`block_regular_on_event_days` ON globally; per-event toggle). Regular bookings blocked via API + calendar UI; event slot booking still allowed.
- [ ] Offering slot instances: materialize on go-live vs compute on the fly?

---

# Feature C — Stripe integration

## Problem statement

Deposits and payments are referenced in Features A and B but need a single payment platform. Without Stripe (or equivalent), staff collect money outside the app (Venmo, bank transfer) with no automatic tie to booking status.

## Scope

| Area | Scope |
|------|--------|
| Account | Stripe Connect (multi-artist) or single Stripe account per business |
| Checkout | Stripe Checkout for deposits and full payment |
| Webhooks | `checkout.session.completed`, `payment_intent.succeeded`, refunds |
| Booking tie-in | `payment_status` on appointments, booking links, offering bookings |
| Receipts | Trigger Feature D email on successful payment |
| Travel fee | Line item or adjustable amount at checkout (Feature G) |

## Phases

### C1 — Deposits on custom links (A2) ✅ *implemented locally*

- Create Checkout session when client confirms booking link with deposit
- `deposit_amount` on link → Stripe line item
- Webhook confirms appointment + marks link paid
- Success page at `/book/:token/success` (also works without webhook via session verify)

### C2 — Deposits on offering bookings (B4)

- Deposit required (or optional %) on public offering checkout
- Capacity held pending payment; release slot on timeout

### C3 — Full payment & refunds

- Pay remaining balance before or after appointment
- Staff-initiated refund from appointment detail
- Payment history on client record

## Data model (proposed)

```sql
-- Extend appointments
ALTER TABLE appointments ADD COLUMN deposit_amount REAL DEFAULT 0;
ALTER TABLE appointments ADD COLUMN amount_paid REAL DEFAULT 0;
ALTER TABLE appointments ADD COLUMN payment_status TEXT DEFAULT 'unpaid';
  -- unpaid | deposit_paid | paid | refunded | failed
ALTER TABLE appointments ADD COLUMN stripe_checkout_session_id TEXT;
ALTER TABLE appointments ADD COLUMN stripe_payment_intent_id TEXT;

CREATE TABLE payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  appointment_id INTEGER REFERENCES appointments(id),
  booking_link_id INTEGER REFERENCES booking_links(id),
  stripe_payment_intent_id TEXT,
  amount REAL NOT NULL,
  type TEXT NOT NULL,           -- deposit | balance | full | travel_fee | refund
  status TEXT NOT NULL,         -- pending | succeeded | failed | refunded
  created_at TEXT DEFAULT (datetime('now'))
);
```

## API endpoints (proposed)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/payments/checkout` | Public/Staff | Create Stripe Checkout session |
| `POST` | `/api/webhooks/stripe` | Stripe | Handle payment events |
| `GET` | `/api/appointments/:id/payments` | Staff | Payment history |
| `POST` | `/api/appointments/:id/refund` | Staff | Initiate refund |

## Phased approach (decided for local / pre-SaaS)

| Phase | When | Stripe setup |
|-------|------|----------------|
| **Now (C1–C2)** | Single business, local dev | One Stripe **test** account; keys in Wrangler/env secrets |
| **SaaS (later)** | Multi-artist platform | **Stripe Connect** + per-artist onboarding wizard |

Do not build Connect or onboarding until multi-tenant SaaS is in scope. C1 can ship against a single merchant account.

## Deferred — decide at SaaS level

These do not block local C1 work. Revisit when moving to multi-tenant hosting:

- [ ] Stripe Connect vs single merchant per tenant (leaning **Connect**)
- [ ] Platform / application fee model
- [ ] Connected account onboarding UX (wizard vs Stripe-hosted)
- [ ] Who owns disputes and chargebacks (platform vs connected account)
- [ ] Payout schedule and tax reporting per artist
- [ ] Whether each artist gets their own Checkout branding or one platform brand

## Open questions (C1 local)

- [ ] Hold slot for how long while checkout is open? *(separate from 48h link expiry — decide with C1)*
- [ ] Webhook signing secret storage (Wrangler secrets / env)

## Open questions (resolved for local)

- [x] Stripe Connect vs single merchant account? → **Single test account now; Connect at SaaS**
- [x] Currency: USD default + per-link override (A1); Stripe must support chosen currency at checkout

## Acceptance criteria

- [x] Client can pay deposit via Stripe on booking link confirm
- [x] Webhook reliably updates appointment payment status
- [x] Failed / abandoned checkout does not confirm booking (or releases slot)
- [x] Staff can see payment status on appointment

---

# Feature D — Email

## Problem statement

Clients and staff need automatic communication on booking events — not just in-app state. Today there is no email sending at all.

## Scope

| Email type | Trigger | Recipient |
|------------|---------|-----------|
| Booking confirmation | Appointment created / confirmed | Client |
| Payment receipt | Stripe payment succeeded | Client |
| Booking link sent | *(optional)* Staff copies link; no auto-send in v1 | — |
| Staff new booking alert | Appointment or offering booked | Assigned staff / admin |
| Reminder | See Feature E | Client |
| Cancellation | Appointment cancelled | Client + staff |

## Phases

### D1 — Transactional email (core) ✅ *implemented locally*

- Provider: Resend (via `RESEND_API_KEY` in `.dev.vars`)
- Templates: branded HTML confirmation with travel fee, address, payment receipt
- SMS + WhatsApp: placeholder toggles log to server console (Twilio / WhatsApp Business API later)
- Requires client `email` on booking flows (Feature A, B)
- Failed sends logged; booking never blocked

### D2 — Staff notifications

- Email admin when new public booking or paid deposit
- Configurable notification address per business

### D3 — Branded templates ✅ *domain connect implemented locally*

- Business name in email body (from Feature H)
- **Domain connect:** Settings → verify domain via Resend DNS records; send from `bookings@yourdomain.com`
- Falls back to `EMAIL_FROM` env or Resend onboarding address until domain verified
- HTML + plain-text templates (logo in header — later)

## Data model (proposed)

```sql
CREATE TABLE email_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  appointment_id INTEGER REFERENCES appointments(id),
  recipient TEXT NOT NULL,
  template TEXT NOT NULL,
  status TEXT NOT NULL,         -- sent | failed | bounced
  provider_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Business settings (or env for v1)
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- e.g. business_name, notification_email, email_from_address
```

## Open questions

- [ ] Email provider choice (Resend is simple for Workers) → **Resend; domain connect in Settings (D3)**
- [ ] Send from own domain (SPF/DKIM setup) vs provider domain → **DNS wizard via Resend domain connect**
- [ ] Client opt-out / marketing vs transactional only
- [ ] Queue vs send inline from Worker (rate limits)

## Acceptance criteria

- [x] Client receives confirmation email with date, time, location, total
- [x] Client receives receipt after Stripe payment (included in confirmation email)
- [x] Failed sends logged; do not block booking on email failure
- [x] SMS / WhatsApp placeholders log intended message when enabled in Settings

---

# Feature E — Reminders

## Problem statement

Confirmations are not enough — clients forget early-morning Carnival slots and on-location appointments. Automated reminders reduce no-shows.

## Scope

| Area | Scope |
|------|--------|
| Channels | Email (D1); SMS optional later (Twilio) |
| Default schedule | e.g. 24 hours before + 2 hours before |
| Config | Per-business or per-offering reminder rules |
| Content | Date, time, address, deposit balance due, prep instructions |
| Staff reminders | Optional morning-of digest for artist |

## Phases

### E1 — Email reminders ✅ *implemented locally*

- Cron / scheduled Worker: find appointments in reminder window (hourly)
- 24h and 2h before appointment; toggles in Settings
- Send via Resend; SMS/WhatsApp placeholders
- Track `reminder_24h_sent_at` / `reminder_2h_sent_at` to avoid duplicates
- **Balance block:** only when client paid a deposit/partial payment (`amount_paid > 0` and balance remaining) — includes amount paid + balance due; paid-in-full clients get standard reminder only

### E2 — Configurable timing

- Settings: `remind_24h`, `remind_2h`, custom hours before
- Skip if appointment cancelled or already reminded

### E3 — SMS reminders *(later)*

- Twilio integration; requires client phone + opt-in
- Same schedule engine as E1

## Data model (proposed)

```sql
ALTER TABLE appointments ADD COLUMN reminder_24h_sent_at TEXT;
ALTER TABLE appointments ADD COLUMN reminder_2h_sent_at TEXT;

CREATE TABLE reminder_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  offering_id INTEGER REFERENCES offerings(id),  -- null = global default
  hours_before INTEGER NOT NULL,
  channel TEXT NOT NULL DEFAULT 'email',         -- email | sms
  active INTEGER NOT NULL DEFAULT 1
);
```

## Scheduling note

Cloudflare Workers have no built-in cron in all plans — options:

- **Cron Trigger** on Worker (Wrangler `triggers.crons`)
- External cron hitting `/api/cron/reminders` with secret
- Queue delayed jobs (Cloudflare Queues)

## Open questions

- [ ] Default reminder times: 24h + 2h enough for Carnival early slots?
- [ ] Extra reminder for 5am appointments (e.g. 12h + 2h)?
- [ ] Remind when deposit unpaid?
- [ ] SMS opt-in compliance (TCPA / local rules)

## Acceptance criteria

- [x] Email reminder sent once per configured window per appointment
- [x] Cancelled appointments do not receive reminders
- [x] Reminder includes address when travel / on-location booking
- [x] Deposit payers get extra balance-due text; paid-in-full clients do not

---

# Feature F — Google Calendar sync

## Problem statement

Many artists manage personal availability in Google Calendar. Duplicating bookings manually into Google is error-prone. One-way sync from Open Salon → Google keeps the artist’s real calendar accurate.

## Scope

| Area | Scope |
|------|--------|
| Direction | **v1: one-way push** (Open Salon → Google); two-way sync is v2+ |
| Per staff | Each staff member connects their Google account (OAuth) |
| Events | Create / update / delete Google event when appointment changes |
| Event details | Title (client + service), time, location (client address), notes |
| Offerings | Carnival blocks appear as busy or named events on sync |

## Phases

### F1 — OAuth connect

- Staff settings: “Connect Google Calendar”
- Store refresh token securely (encrypted / Wrangler secret per staff)
- Google Calendar API scope: `calendar.events`

### F2 — Push on appointment CRUD

- On create/update/cancel appointment → upsert/delete Google event
- Store `google_event_id` on appointment for idempotent updates

### F3 — Offering / busy blocks

- Sync offering slots staff is assigned to (or all-day busy on Carnival days)

### F4 — Two-way sync *(later, complex)*

- Import Google busy times as `blocked_slots`
- Conflict detection when booking

## Data model (proposed)

```sql
ALTER TABLE staff ADD COLUMN google_refresh_token TEXT;  -- encrypt at rest
ALTER TABLE staff ADD COLUMN google_calendar_id TEXT DEFAULT 'primary';
ALTER TABLE appointments ADD COLUMN google_event_id TEXT;
```

## API endpoints (proposed)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/staff/:id/google/auth` | Staff | Start OAuth flow |
| `GET` | `/api/staff/google/callback` | Google | OAuth callback |
| `DELETE` | `/api/staff/:id/google` | Staff | Disconnect |
| `POST` | `/api/appointments/:id/sync-google` | Staff | Manual re-sync |

## Open questions

- [ ] One Google account per staff or shared salon calendar?
- [ ] Event visibility: private vs show client name?
- [ ] Sync travel time as separate calendar block?
- [ ] Token refresh failure handling + staff alert

## Acceptance criteria

- [ ] Staff can connect Google account once
- [ ] New appointment appears on Google Calendar within ~1 min
- [ ] Cancelled appointment removes Google event
- [ ] Update to time/date updates existing Google event (no duplicates)

---

# Feature G — Optional travel fee

## Problem statement

Mobile makeup and on-location Carnival prep require travel surcharges. Fee should be optional per booking — flat rate, distance-based, or staff-entered — and flow through to total, Stripe checkout, and reminders.

## Scope

| Area | Scope |
|------|--------|
| When | Custom booking link (A), offering booking (B), staff manual booking |
| Client input | Address collected on public forms (Feature A) enables fee calculation |
| Fee types | Flat fee, per-mile/km, zone-based, or manual override by staff |
| Display | Show travel fee separately on confirmation, email, Stripe line item |
| Calendar | Client address in appointment notes / Google event location (F) |

## Phases

### G1 — Manual travel fee ✅ *implemented locally*

- Staff toggles “Add travel fee” on booking link or appointment
- Flat amount field; added to `total_price` and Stripe checkout

### G2 — Address-based flat zones

- Settings: zones (e.g. Castries, north, south) with fixed fees
- Client address matched to zone (simple keyword or postal code)

### G3 — Distance-based *(later)*

- Google Maps Distance Matrix API from studio address to client
- Fee = base + (distance × rate); cap max fee

## Data model (proposed)

```sql
ALTER TABLE appointments ADD COLUMN travel_fee REAL DEFAULT 0;
ALTER TABLE appointments ADD COLUMN service_address TEXT DEFAULT '';

ALTER TABLE booking_links ADD COLUMN travel_fee REAL DEFAULT 0;
ALTER TABLE booking_links ADD COLUMN include_travel_fee INTEGER DEFAULT 0;

CREATE TABLE travel_zones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  fee REAL NOT NULL DEFAULT 0,
  match_pattern TEXT DEFAULT ''   -- optional: parish, postal code prefix
);
```

## UX

**Custom link (staff):**
- [x] Include travel fee — flat $___ on booking link create

**Public confirm (client):**
- [x] Address field required when travel fee enabled
- [x] Show: Service $X + Travel $Y = Total $Z before confirm

**Offering booking:**
- Optional “On-location” add-on or per-booking address + fee

## Open questions

- [ ] Default: travel fee on or off for custom links?
- [ ] Studio / base address for distance calc (settings)?
- [ ] Travel fee refundable if client cancels?
- [ ] St. Lucia–specific zones vs generic flat fee for v1?

## Acceptance criteria

- [x] Staff can add optional flat travel fee to booking link
- [x] Travel fee included in Stripe checkout total (Feature C)
- [x] Travel fee and address appear on confirmation email (Feature D)
- [x] Travel fee and address appear on reminder (Feature E)
- [ ] Google Calendar event location set to client address when present (Feature F)

---

# Feature H — Branding (logo & business name)

## Problem statement

Client-facing pages, emails, and checkout should show **your** business — not generic "Salon Manager" / Open Salon defaults. Mobile makeup artists and Carnival pop-ups need recognizable branding when sharing booking links and offering pages.

## Scope

| Surface | What appears |
|---------|----------------|
| Staff app sidebar | Logo + business name (replaces "Salon Manager") |
| Public booking link (`/book/:token`) | Logo, business name, optional tagline |
| Public offering page (`/offer/:slug`) | Same header treatment |
| Confirmation screens | Branded header after client books |
| Email (D) | Logo in header, business name in from-name / footer |
| Stripe Checkout (C) | Business name; logo via Stripe Dashboard or Checkout branding API |
| Browser tab / PWA | `manifest.json` title and icons from settings *(optional)* |

## Phases

### H1 — Core settings (name + logo) ✅ *implemented locally*

- Staff **Settings → Branding** section
- Fields: business name (required), tagline (optional), logo upload (PNG/JPEG/WebP/SVG, max 512 KB)
- Logo stored in `_meta.logo_url` as data URL or https URL *(R2 upload when deployed)*
- Live preview of public booking header
- Staff sidebar uses business name + logo (initials fallback when no logo)
- `GET /api/public/branding` for client pages; `/book/:token` shows branding *(partial H2)*

### H2 — Public page branding

- Apply branding to `/book/:token` and `/offer/:slug` (Features A, B)
- Minimal public layout: logo top-center, business name, no Open Salon branding *(or subtle "Powered by" footer — product decision)*

### H3 — Email & checkout branding

- Email templates (D3) pull logo URL + business name from settings
- Stripe Checkout: `business_name` or Connect account branding
- Receipt and confirmation emails match public page look

### H4 — Extended brand kit *(later)*

- Primary brand color → CSS variables on public pages
- Favicon upload
- Custom domain for booking links (`book.yourbusiness.com`)

## Data model (proposed)

Extends the `settings` table introduced in Feature D, or dedicated columns:

```sql
-- Key-value settings (shared with D, G, etc.)
INSERT OR REPLACE INTO settings (key, value) VALUES
  ('business_name', 'Carnival Beauty Hub'),
  ('business_tagline', 'St. Lucia · Mobile Glam'),
  ('logo_url', '/uploads/logo.png'),
  ('brand_primary_color', '#ec4899'),
  ('public_footer_text', '');

-- Or structured business profile table
CREATE TABLE business_profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),  -- single-tenant v1
  name TEXT NOT NULL DEFAULT '',
  tagline TEXT DEFAULT '',
  logo_url TEXT DEFAULT '',
  primary_color TEXT DEFAULT '#7c3aed',
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  studio_address TEXT DEFAULT '',          -- also used by travel fee (G)
  updated_at TEXT DEFAULT (datetime('now'))
);
```

### Logo storage

| Option | Pros | Cons |
|--------|------|------|
| Cloudflare R2 | Fits Workers stack; cheap | Upload API needed |
| Base64 in DB | Simple for MVP | Bad for large images |
| External URL | No storage | Staff must host image |

**Recommendation:** R2 + presigned upload, or static upload to `public/` for self-hosted v1.

## API endpoints (proposed)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/settings/branding` | Staff | Current name, logo, colors |
| `PUT` | `/api/settings/branding` | Staff | Update business name, tagline, colors |
| `POST` | `/api/settings/branding/logo` | Staff | Upload logo file |
| `GET` | `/api/public/branding` | Public | Name + logo URL for client pages (no secrets) |

## UX — Settings → Branding

1. Business name *
2. Tagline (optional)
3. Logo upload with crop/preview (square or horizontal)
4. Live preview: mobile booking page mockup
5. Save

## Open questions

- [ ] Remove all "Open Salon" / "Salon Manager" text on public pages?
- [ ] Default logo when none uploaded (initials avatar from business name)?
- [ ] Max logo file size and dimensions?
- [ ] Multi-location businesses: one brand or per-location *(future)*?
- [ ] `manifest.json` / PWA icons auto-generated from logo?

## Acceptance criteria

- [x] Staff can set business name and upload logo in settings
- [x] Staff sidebar shows custom name + logo
- [ ] Public booking link page displays business branding (H2) — *partial: `/book/:token` done; `/offer/:slug` pending B2*
- [ ] Confirmation email includes business name and logo (H3 + D3)
- [x] Settings survive DB backup / redeploy *(stored in `_meta`)*

---

# Shared

## How features work together

```
Regular day          → staff calendar + regular services
Carnival Mon/Tue     → offering slot grid + public booking (B2)
One-off 7am request  → custom booking link (A1)
Deposit / pay        → Stripe checkout (C) on link or offering confirm
Confirmation         → email (D) with address + travel line items (G)
Before appointment   → reminder (E) via email
Artist calendar      → Google sync (F) with location from client address
Client-facing UI     → business name + logo (H) on links, offerings, emails
```

## Current codebase gaps

| Item | Status |
|------|--------|
| Public routes | None |
| Authentication | None |
| Stripe / payments | None |
| Email / reminders | None |
| Google Calendar sync | None |
| Travel fee | None |
| Business branding | Generic "Salon Manager" sidebar; no settings |
| Client `address` | Not in schema |
| Flat `services` only | No availability windows, slots, capacity, add-ons |
| Calendar | Staff × time columns only; fixed 7 AM–8 PM grid |
| `blocked_slots` | Per-staff breaks — not a substitute for offerings |

**Reusable today**

- `appointments` + `appointment_services` — extend for offerings
- `POST /api/appointments` — booking logic to adapt
- Status workflow, staff lookup, client CRUD

## Dev / ops notes

- **License:** `LICENSE` is MIT; `README` says AGPL-3.0 — confirm before commercial use.
- **Stack:** Hono on Cloudflare Workers + D1; frontend Preact + Vite.
- **Dev quirk fixed locally:** Vite must ignore `.wrangler/**` in `watch.ignored` to avoid reload loops when the DB writes.
- **README outdated:** API port 8787 (not 3004), UI often 5173 (not 5174).

## Suggested build order

1. ~~**A1** — Custom booking link~~ ✅
2. ~~**H1** — Business name + logo settings~~ ✅
3. ~~**B1** — Offerings wizard + staff calendar slots~~ ✅
4. ~~**G1** — Manual travel fee on links / appointments (mobile makeup)~~ ✅
5. ~~**C1** — Stripe deposits on booking links (A2)~~ ✅
6. ~~**H2** — Branding on public booking / offering pages~~ ✅ *(BusinessHeader on public pages)*
7. ~~**D1** — Transactional email (confirmation + receipt)~~ ✅
8. ~~**E1** — Email reminders (24h / 2h before)~~ ✅
9. ~~**B2** — Public offering booking~~ ✅
10. **C2** — Stripe on offering bookings (B4)
11. **F1–F2** — Google Calendar connect + push sync
12. **A3** — Auth and hardening
13. **B3** — Year-over-year templates
14. **H3–H4, C3, D2–D3, E3, F3–F4, G2–G3** — Email/checkout branding, custom domain, refunds, SMS, two-way sync, zone fees

## Open questions (Feature A)

- [ ] Is address required or optional for v1?
- [ ] Default link expiry: 24h, 48h, or 7 days?
- [ ] Custom price only, or must link reference catalog services?
- [ ] After confirm without payment: status `booked` or `confirmed`?
- [ ] Should staff get a link preview before sending?

## Open questions (Feature H)

See [Feature H — Branding](#feature-h--branding-logo--business-name) open questions.

---

# Future considerations

Items not yet scoped as Features I–N but worth tracking. Prioritized for **mobile makeup + Carnival / seasonal events** (St. Lucia context).

## High impact — consider before or during first Carnival season

### I — WhatsApp & mobile-first sharing

Clients arrive via Instagram DMs and WhatsApp, not email.

- One-tap **Share to WhatsApp** with pre-filled message + booking/offering link
- Links that work in in-app browsers (Instagram, WhatsApp WebView)
- SMS or WhatsApp reminders as alternative to email (E3); may matter more than email locally
- `wa.me` / `sms:` share buttons on staff “copy link” flows

### J — Cancellation & refund policy

Required once Stripe (C) is live; painful to handle manually during Carnival week.

- Configurable rules: cancel before X hours → full/partial/no refund
- Automated Stripe refund when within policy
- Staff override with reason logged
- Client-facing policy text on public confirm pages

### K — Client magic link portal (no account)

Light self-service without login:

- Link in confirmation email: view booking, cancel (within policy), request reschedule
- Reduces “what time was I?” DMs during busy season

### L — Day-of operations view

Calendar schedules; Carnival **runs** on a roster:

- List view sorted by time: client, phone, address, add-ons, deposit status, notes
- Printable / phone-friendly **day sheet** per artist
- Quick status: confirmed → arrived → in progress → done
- Filter by offering (e.g. Carnival Monday only)

### M — Extended calendar hours

Current app calendar is **7 AM–8 PM** (`calendar-view.tsx`). Carnival makeup often starts **5–6 AM**.

- Configurable day start/end globally or per offering
- Offering wizard should drive visible hours on event dates

### N — Booking intake (client prep)

Optional on public book (A/B) or post-confirm link:

- Inspiration photo upload
- Allergies / skin type / preferences
- Outfit colors, hair length, special requests
- Stored on appointment + visible on day-of roster (L)

### O — Waitlist + checkout slot hold

- **Slot hold:** client selects slot → hold 10–15 min during Stripe checkout → release if abandoned (critical for scarce Carnival slots)
- **Waitlist:** when slot full, join queue; notify (email/SMS/WhatsApp) on cancellation

Fold into B2/C2 implementation rather than building separately.

## Medium impact — v2+

| Item | Notes |
|------|--------|
| **Link-in-bio landing page** | Single URL: Carnival 2026, bridal, custom link request |
| **QR code per offering** | Booth print; scan to book |
| **Buffer time between appointments** | 15 min cleanup between back-to-back Carnival clients |
| **Client preferences profile** | Reuse year over year (“bold brows”, usual add-ons) |
| **Mark paid outside Stripe** | Bank transfer / cash; staff marks deposit received |
| **Timezone** | Store UTC, display St. Lucia (AST); matters if staff travels |
| **Staff roles** | Admin vs artist vs reception — refunds, revenue, offering edit |
| **Backup / export** | D1 export; client CSV before each season |
| **Reviews / post-visit** | Optional thank-you + review link after `completed` |

## Foundations — decide early, fix late if ignored

| Topic | Why it matters |
|-------|----------------|
| **Auth (A3)** | Public booking exposes client PII; don’t defer too long |
| **DB migrations** | Many new tables coming; plan before real Carnival data |
| **Currency** | XCD vs USD display; Stripe settlement currency |
| **License** | MIT vs AGPL in repo — before commercial product |
| **Single-tenant vs SaaS** | Shapes `business_profile`, settings, Stripe Connect |

## Explicitly out of scope (for now)

- Native iOS/Android apps (see mobile strategy below)
- Full POS / retail inventory
- Loyalty points / marketing automation
- Two-way Google Calendar sync (F4)
- AI scheduling optimization

## Suggested priority if Carnival 2026 is the deadline

1. B1 + H1 + H2 — offerings on calendar, branded public page  
2. B2 + O (slot hold) + C1 — public book with deposit  
3. E1 + I (WhatsApp share) — reminders where clients actually look  
4. L — day-of roster  
5. J, K, M, N — as time allows before go-live  

---

# Mobile strategy — app vs mobile-optimized web

## Short answer

**Start with mobile-optimized web (PWA-friendly).** A native app is optional later — only if you hit clear limits of the browser or need App Store distribution.

Makeup artists live on their phones; that does **not** automatically mean you need an App Store app.

## Why mobile web first is the right default

| Factor | Mobile web | Native app |
|--------|------------|------------|
| **Install friction** | Open link, add to home screen — zero App Store | Download, updates, reviews, two codebases |
| **Client booking** | Share link in WhatsApp/IG — opens instantly | “Download our app” kills conversion |
| **Your stack** | Preact + Vite already; responsive CSS | React Native / Flutter = separate project |
| **Updates** | Deploy once; everyone on latest | App review delay; users on old versions |
| **Carnival timeline** | Ship in weeks | Months + store accounts |

Clients booking Carnival at 11pm from an Instagram story will not install an app. They will tap a link.

## What “SUPER mobile friendly” means in practice

Design for **phone-first**, not “desktop that shrinks”:

**Staff (artist on the go)**

- Bottom nav or thumb-reachable actions (new link, today’s roster, calendar)
- Large tap targets (you already have `?agent` mode for automation — reuse large-target patterns for humans)
- Day-of roster (L) as default home during event week
- One-tap copy link / share to WhatsApp
- Calendar that scrolls vertically on small screens; swipe day navigation
- Works on spotty connectivity: optimistic UI, clear “saved” / retry states

**Clients (public pages)**

- Single-column layout; no sidebar
- Minimal fields above the fold; sticky “Confirm” / “Pay deposit” button
- Native date/time inputs; avoid tiny custom pickers
- Fast load (no heavy JS); works in WhatsApp in-app browser
- Branding (H) visible without horizontal scroll

**Technical**

- Responsive breakpoints; test on iPhone SE and common Android widths
- `viewport` meta, safe-area insets for notched phones
- **PWA:** `manifest.json` + service worker for “Add to Home Screen” icon (H4) — feels app-like without the store
- Touch-friendly: 44px minimum tap targets

## When a native app might be worth it (later)

Consider **only if** you need one or more of:

- Push notifications without email/SMS (though web push on PWA is often enough)
- Deep OS integration (contacts, calendar write without Google OAuth flow)
- Offline-first with complex sync (full day of appointments editable offline)
- App Store presence as a marketing/trust signal for a large multi-artist brand
- Card-present Stripe Terminal / Bluetooth hardware

For a solo or small team makeup business in St. Lucia, **none of these are MVP blockers.**

## Recommended path

```
Phase 1  → Responsive mobile web (all flows)
Phase 2  → PWA (install icon, splash, optional web push for staff alerts)
Phase 3  → Evaluate native app only after real usage data
           (e.g. “artists refuse to use browser” or “we need Terminal”)
```

**Do not** fork to React Native until mobile web is in artists’ hands and you know what’s broken.

## Open questions (mobile)

- [ ] PWA install prompt for staff only, or also clients?
- [ ] Web push for “new booking” staff alerts vs email only?
- [ ] Test matrix: iOS Safari, Chrome Android, WhatsApp in-app browser, Instagram in-app browser
- [ ] Primary staff device: iPhone vs Android split?

---

## Progress log

| Date | Notes |
|------|-------|
| 2026-06-26 | Document created. Feature A: custom off-hours booking link with client self-fill. |
| 2026-06-26 | Feature B added: seasonal bookable offerings (Carnival scenario), wizard, slots, capacity, add-ons, go-live calendar behavior. |
| 2026-06-26 | Features C–G added: Stripe (unified), email, reminders, Google Calendar sync, optional travel fee. Build order updated. |
| 2026-06-26 | Feature H added: logo and business name customization (staff app, public pages, email, Stripe). |
| 2026-06-26 | Future considerations (I–O) + mobile strategy (web/PWA vs native app). |
| 2026-06-26 | **A1 implemented:** booking links API, public `/book/:token` page, calendar “Booking link” UI, Neon migrations folder. |
| 2026-06-26 | **H1 implemented:** branding settings API, Settings UI, sidebar branding, public branding on `/book/:token`. Stripe: single test account for C1; Connect deferred to SaaS. |
| 2026-06-26 | **C1 implemented:** Stripe deposit checkout on booking links, webhook, payment status on appointments, Settings Stripe status. |
| 2026-06-26 | **G1 implemented:** Manual flat travel fee on booking links and staff appointments; address required on public confirm; separate Stripe line item; shown on appointment detail. |
| 2026-06-26 | **D1 implemented:** Booking confirmation email via Resend; SMS/WhatsApp placeholder channels; Settings toggles; fires on all booking flows without blocking. |
| 2026-06-26 | **E1 implemented:** 24h/2h email reminders via hourly cron; balance-due block for deposit payers only; Settings reminder toggles. |
| 2026-06-26 | **D3 domain connect:** Resend DNS verification in Settings; custom from address once verified; confirmations/reminders use business domain. |

## References

- Competitor screenshots: `docs/salonist/`, `docs/squareup/`
- App README: `README.md`
- Schema: `src/server/schema.sql`
- API: `src/server/index.ts`
- Current service UI: `src/client/components/create-service.tsx` (flat catalog only)
- Current sidebar label: `src/client/components/sidebar.tsx` ("Salon Manager")
