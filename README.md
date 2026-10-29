# Tex-Trak

Product lifecycle tracking for healthcare environments — label, install, monitor
and retire products across hospital sites from a phone.

Built mobile-first as an installable web app (PWA): it runs in any modern browser,
works with hardware barcode scanners, falls back to the phone camera, and always
allows typing a code by hand.

**Developed by CIRCAI Ltd.**

---

## Quick start

```bash
npm install
```

```bash
npm run dev
```

Configuration is optional — the app ships with working defaults. To point it at
a different Supabase project, set these as environment variables on the host (or
in a local `.env`, which is git-ignored):

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

## Android app

The same interface is packaged as an installable Android app with Capacitor — see
[docs/ANDROID.md](docs/ANDROID.md) to build, install and publish it.

## Roles

Fitters can tap **Guest**, type their name and the guest PIN, and start straight away. Staff sign in
with a **username** (`admin`, `synergy`, `queenmary`, …), not an email address.
Either way the home screen is four big buttons: Dashboard, Install, Take down and
Products.

| Role | Sees | Can do |
|---|---|---|
| **Admin** | Everything | Everything, plus generate QR labels, create accounts and set the change-due window |
| **Synergy** | All sites and all products | Register labels, install, take down, import locations, report |
| **Synergy field** | All sites and all products | The same, but **without Reports** — for team members who do the fitting work only |
| **Hospital** | Only its own hospital | Install, take down and report for that site |
| **Guest** | Install and take down at any site | Type a name and the shared PIN. Nothing else: the overview, products and reports are refused by the database |

Scoping is enforced in the database (row level security), not just the interface:
a hospital login cannot read another hospital's data even by calling the API
directly.

Every user can change their own password under **My account** — current password,
new password and repeat, each with a *Show* toggle. The current password is
re-checked before the change is accepted.

## Working offline

Install, take down, scanning and guest sign-in keep working with no signal — in a
basement ward, a lift, a dead spot. Jobs are saved on the phone, sent in order
when signal returns, and applied by the server only once. A strip under the
header shows what is waiting, and the home screen says when the phone is *Ready
for no signal*. The first sign-in on each phone needs a connection (it downloads
the site and product lists). Details: [docs/HANDOVER.md](docs/HANDOVER.md#working-offline).

## QR labels

Admins generate label codes under **QR labels**, by default
`RZCIR-<product code>-AAA999` — e.g. `RZCIR-MVN191-AAA001`: a prefix, a product
code, then three letters and three digits (an admin can change the prefix and the
letters and digits on the same screen — see below). Up to **50,000 per run** (made in
steps of 1,000 with a progress bar); download the CSV for a label printer, or print a
sheet of 28 × 34 mm labels with the code in small type under each QR — 500 per sheet,
chosen from a list for big runs. Earlier runs are listed under *Recent batches* and
can be reloaded to export or print again.

Codes are issued in **ascending serial order** and are **never reused** — the
counter is held separately from the products table, so deleting a product (or
wiping the demo data) does not free its number, and the database refuses any attempt
to lower or delete a counter. Each prefix, product line and format has its own
series, and every new run carries on from the end of the last one (and from any code
registered by hand beyond it). About 17.5 million codes per line at the default format.

**Changing the format.** Under *QR labels → Code format* an admin picks 1–6 letters
and 1–8 digits; the preview and the number of codes it allows update as you choose
(formats allowing fewer than 10,000 are refused). A new format applies to labels
generated from then on — labels already printed keep working, because scanning only
checks the prefix. Each format has its own numbering that starts at
`…001`, so switching to 4 + 4 begins at `AAAA0001`, and switching back resumes
where 3 + 3 stopped. Codes of different shapes can never be equal, so nothing is
ever issued twice.

**Changing the prefix.** The same *Code format* panel has a *Prefix* field (3–10
letters or digits). New labels carry it from then on. Labels already printed with
an earlier prefix keep working: every prefix ever used stays accepted, and each
prefix has its own numbering.

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
  lib/offline/  job queue, product/site snapshot, offline PIN, network health
  pages/        Login, Dashboard, Install, Takedown, Register, Inventory,
                ProductDetail, Reports, Locations, Labels, Admin
supabase/       SQL migrations and the admin-create-user edge function
docs/           HANDOVER.md — credentials, operations, outstanding items
```

See [docs/HANDOVER.md](docs/HANDOVER.md) for logins, the data model and the
operational runbook.
