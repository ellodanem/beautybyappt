# Service page redesign — revert guide

**Created:** 2026-06-27  
**Purpose:** Backup before two-column booking layout, time slot chips, and sticky summary sidebar.

## Quick revert

From the `open-salon` directory, restore the backed-up files:

```powershell
Copy-Item ".backups\service-page-redesign-2026-06-27\public-anytime.tsx" "src\client\public-anytime.tsx" -Force
Copy-Item ".backups\service-page-redesign-2026-06-27\public-offer.tsx" "src\client\public-offer.tsx" -Force
Copy-Item ".backups\service-page-redesign-2026-06-27\public-page-shell.tsx" "src\client\components\public-page-shell.tsx" -Force
Copy-Item ".backups\service-page-redesign-2026-06-27\business-header.tsx" "src\client\components\business-header.tsx" -Force
Copy-Item ".backups\service-page-redesign-2026-06-27\use-public-branding.ts" "src\client\hooks\use-public-branding.ts" -Force
Copy-Item ".backups\service-page-redesign-2026-06-27\branding.ts" "src\server\branding.ts" -Force
```

Then delete the new shared components (if present):

```powershell
Remove-Item "src\client\components\public-booking-top-bar.tsx" -ErrorAction SilentlyContinue
Remove-Item "src\client\components\public-time-slot-picker.tsx" -ErrorAction SilentlyContinue
Remove-Item "src\client\components\public-booking-summary.tsx" -ErrorAction SilentlyContinue
Remove-Item "src\client\lib\public-booking-utils.ts" -ErrorAction SilentlyContinue
```

Also revert `src/shared/platform-branding.ts` — remove the optional `timezone?: string` field from `PublicBrandingResponse` if you want a full rollback.

If you added timezone to `/api/public/branding`, `branding.ts` is restored from backup above.

## Previous layout (before redesign)

| Area | Config |
|------|--------|
| **Layout** | Single column, `max-w-md`, centered |
| **Header** | Centered `BusinessHeader` (logo + name stacked) |
| **Time slots** | Full-width list rows with price on the right |
| **Summary** | Inline grey box inside the details form (duplicated service/date/price) |
| **CTA** | Only at bottom of details form ("Book appointment") |
| **Background** | Plain white (`bg-background`) |
| **Public branding API** | `business_name`, `business_tagline`, `logo_url`, `platform` only |

## Files in this backup

- `public-anytime.tsx` — anytime service booking page
- `public-offer.tsx` — event offering booking page
- `public-page-shell.tsx` — minimal page wrapper
- `business-header.tsx` — centered branding header
- `use-public-branding.ts` — public branding hook
- `branding.ts` — server public branding route (before timezone field)

## New files added by redesign

- `src/client/lib/public-booking-utils.ts`
- `src/client/components/public-booking-top-bar.tsx`
- `src/client/components/public-time-slot-picker.tsx`
- `src/client/components/public-booking-summary.tsx`
