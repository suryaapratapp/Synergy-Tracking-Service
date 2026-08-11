# Product Tracker

Product lifecycle tracking for healthcare environments — label, install, monitor
and retire products across hospital sites from a phone.

Built mobile-first as an installable web app (PWA): it runs in any modern browser,
works with hardware barcode scanners, falls back to the phone camera, and always
allows typing a code by hand.

**Developed by RZ Circular Ltd.**

---

## Quick start

```bash
npm install
```

```bash
npm run dev
```

The app expects a `.env` file (already present for the live project):

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_xxxxxxxx
```

The publishable key is safe to ship in the browser bundle — every table is behind
row level security and nothing is readable before sign-in.

| Command | What it does |
|---|---|
| `npm run dev` | Development server on http://localhost:5180 |
| `npm run build` | Type-check and produce `dist/` |
| `npm run preview` | Serve the production build on http://localhost:4173 |
| `npm run typecheck` | Types only, no bundle |

## Deploying

The build output is a static site. `vercel.json` and `netlify.toml` are included
and both set the SPA rewrite plus caching and security headers, so a straight
"import repo → deploy" works on either host with no further setup.

Serve over **HTTPS** — the camera scanner will not start on plain HTTP (localhost
excepted), and the PWA will not install.

## Roles

Staff sign in with a **username** (`admin`, `synergy`, `queenmary`, …), not an
email address.

| Role | Sees | Can do |
|---|---|---|
| **Admin** | Everything | Everything, plus generate QR labels, create accounts and set the change-due window |
| **Synergy** | All sites and all products | Register labels, install, take down, import locations, report |
| **Hospital** | Only its own hospital | Install, take down and report for that site |

Scoping is enforced in the database (row level security), not just the interface:
a hospital login cannot read another hospital's data even by calling the API
directly.

## QR labels

Admins generate label codes under **QR labels** in the fixed format
`RZCIR-<first four letters of the product>-AAAAXXXX` — e.g. `RZCIR-CURT-AAAA0001`,
four letters then four digits. Up to 500 per click; download the CSV for a label
printer, or print a sheet of 28 × 34 mm labels with the code in small type under
each QR.

Codes are issued in **ascending serial order** and are **never reused** — the
counter is held separately from the products table, so deleting a product (or
wiping the demo data) does not free its number. Each product line has its own
series, and 4.5 billion codes per line.

## How scanning works

Every scan field has a **Tap-free scanning** switch. On, a code is logged the
moment it lands — no confirm button, no Enter key — and the camera keeps reading
so a whole bay can be worked through without touching the screen.

One field accepts all three inputs, and staff can switch freely between them:

1. **Hardware scanner** — Bluetooth/USB ring scanners and the Nordic ID handhelds
   present as a keyboard. The app watches keystroke timing across the whole page,
   so a scan registers wherever the user is, with no pairing step, driver or
   device-specific setup. Nothing to configure: if the phone sees the scanner, the
   app sees the scanner.
2. **Camera** — uses the browser's native barcode detector where available
   (Android Chrome; reads 1D and 2D), and decodes QR codes with a bundled decoder
   everywhere else, which is what makes it work on iPhones.
3. **Typing** — always available, and the only thing needed if a label is damaged.

## Location list

Locations are `Hospital → Floor → Ward → Bay`. Synergy's CSV is imported from
**Locations → Import a location list**. Column order does not matter and headers
are matched loosely:

```csv
Hospital,Code,Floor,Ward,Bay
Queen Mary Hospital,QMH,Ground,Emergency Ward,Bay E1
Queen Mary Hospital,QMH,Level 1,Surgical Ward,Bay S1
```

`Hospital`, `Ward` and `Bay` are required; `Floor` defaults to *Ground* and `Code`
is optional. Imports are additive and idempotent — re-importing a file changes
nothing, and only genuinely new rows are added, so existing installations are
never disturbed.

## Project layout

```
src/
  components/   AppShell, ScanField, CameraScanner, LocationPicker, Charts,
                QrLabel, ui
  context/      AuthContext (session + role), DataContext (location cache)
  hooks/        useHidScanner (hardware scanners), useMeasure
  lib/          supabase client, branding, types, CSV, QR, formatting
  pages/        Login, Dashboard, Install, Takedown, Register, Inventory,
                ProductDetail, Reports, Locations, Labels, Admin
supabase/       SQL migrations and the admin-create-user edge function
docs/           HANDOVER.md — credentials, operations, outstanding items
```

See [docs/HANDOVER.md](docs/HANDOVER.md) for logins, the data model and the
operational runbook.
