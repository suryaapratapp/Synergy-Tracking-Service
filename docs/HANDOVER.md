# Handover — Synergy Tracking Service

Developed by RZ Circular Ltd.
Backend: Supabase project `dnesiqubviwvuavyestr` (region eu-west-2).

---

## 1. Logins

Staff sign in with a **username** — no email address. **Change these passwords
before the system carries real data.**

| Role | Username | Password |
|---|---|---|
| Admin | `admin` | `Admin@2026!` |
| Synergy | `synergy` | `Synergy@2026!` |
| Hospital (Queen Mary) | `queenmary` | `Hospital@2026!` |
| Hospital (St Thomas) | `stthomas` | `Hospital@2026!` |

Supabase Auth is email-keyed underneath, so each account carries a deterministic
internal address `<username>@synergy.local`. Nothing is ever sent to it — it is
only an identifier, and staff never see or type it.

To add a hospital as Synergy onboards it: **Users & settings → Add user**, choose
a username, role *Hospital* and the site. Account creation runs through a Supabase
edge function that checks the caller is an admin before using the service key, so
the privileged key never reaches the browser.

## 2. What the app does

**QR labels** (admin only) — generates label codes in the fixed format
`RZCIR-<first four letters of the product>-<6 digits>`, e.g. `RZCIR-CURT-048213`.
Choose the product and a quantity (up to 500 per click), press generate, then
download the CSV for the label printer or print a ready-made sheet of 28 × 34 mm
labels. Each label carries the QR with the code printed underneath, so a damaged
label can still be typed in. A preview of the exact label is shown before
generating.

> **Uniqueness — worth confirming.** You asked that a code never repeat while it
> is in use, and may be reused once free. The generator is currently *stricter*
> than that: it never issues a code that **any** product still holds, whatever its
> status. That is deliberate — every code carries its own full lifecycle history,
> and recycling a number onto a different curtain would graft one curtain's
> history onto another. With six digits there are 900,000 numbers per product
> line, so exhaustion is not a practical concern. If you do want retired codes
> recycled, it is a one-line change in `rpc_generate_product_codes`.

**Register** (Synergy only) — labels are applied at the Synergy site and each
product is scanned onto the system. Batch, size and colour are set once per run
and applied to every scan. A paste-a-list mode covers bulk labelling.

**Install** — the fitter picks Hospital → Floor → Ward → Bay once, then scans each
product into that bay. Date and installer are recorded automatically and the
change-due date is set to **14 days** (configurable in Users & settings, and
overridable per install). The chosen location is remembered between visits.

**Take down** — two routes, because both happen in practice:
- *By location* (the normal round): pick the bay, tick what is coming down,
  choose a reason, confirm. Reasons are **Expired** (default), **Soiled**,
  **Damage**.
- *By scan*: scan an individual product coming down out of cycle.

**Dashboard / Reports** — live counts, overdue and due-soon lists, fleet
composition, 12-month install vs take-down trend, reasons breakdown, per-hospital
and per-ward views, average service life, and CSV export from both Products and
Reports.

## 3. Data model

| Table | Purpose |
|---|---|
| `hospitals`, `wards`, `bays` | The location list (`wards.floor` carries the floor) |
| `products` | One row per labelled item; `qr_code` is unique, `product_type` keeps the model open for future product lines |
| `installations` | One row per install→take-down cycle, with reason and notes |
| `product_events` | Append-only audit trail of everything that happened |
| `profiles` | Role and hospital scope, linked to the auth user |
| `app_settings` | `default_change_due_days` (14) and `product_line` |

A partial unique index guarantees a product can only have one live installation
at a time, so double-installs are impossible rather than merely discouraged.

Reads go through the `v_products`, `v_installations` and `v_locations` views.
Writes go through `rpc_register_product`, `rpc_install_product`, `rpc_takedown`,
`rpc_import_locations` and `rpc_set_product_status`, each of which re-checks the
caller's role and site before touching anything.

## 4. Security

- Row level security is on for every table; nothing is readable before sign-in.
- The `anon` role has no rights at all — verified by direct API calls.
- Hospital logins are pinned to their own site in the database. Asking the API
  for another hospital's products returns nothing; the dashboard RPC ignores a
  hospital filter it is not entitled to.
- Only Synergy and Admin can register products or import locations.
- Only Admin can create accounts or change roles.

**Outstanding:** enable *Leaked password protection* in
Supabase → Authentication → Policies. It is off by default and checks new
passwords against HaveIBeenPwned. Worth switching on once real passwords are set.

## 5. Demo data

The database is seeded with a working demonstration set: 3 hospitals, 16 wards,
49 bays, ~560 products and 12 months of installation history.

Every demo product carries a `DEMO-` batch prefix. To clear it before go-live:

```sql
delete from public.products where batch like 'DEMO-%';
```

Installations and events cascade with the products. Locations are kept — replace
them by importing Synergy's real CSV, then deleting any placeholder hospitals that
are not wanted.

The three placeholder hospitals (Queen Mary, St Thomas General, Royal Albert) are
stand-ins until the real location list arrives.

## 6. Hardware notes

**Tap-free scanning** — every scan field carries a *Tap-free scanning* checkbox.
Switched on, a code commits the instant it lands: no "Enter code" button, no
Enter key. The camera also stays open and keeps reading, ignoring the same label
for 2.5 seconds so one curtain is never logged twice, and showing a running
count. The setting is remembered per device, so a fitter sets it once. Left off,
the confirm button behaves exactly as before.

- **Bluetooth / ring scanners** and **Nordic ID HH83**: pair as a keyboard (HID
  mode). No app configuration. The app distinguishes a scan from typing by
  keystroke speed, so scanning works from any screen.
- If a scanner is set to a "no Enter suffix" mode it still works — the app flushes
  the buffer once input goes quiet.
- **Camera** needs HTTPS and a one-time permission grant. On iPhone the bundled
  decoder handles QR codes; Android Chrome additionally reads 1D barcodes natively.
- If neither is available, typing the code always works.

## 7. Known limits / suggested next steps

1. **Offline** — the app shell is cached so it opens without signal, but writes
   need a connection. If fitters work in basements, an offline queue is the next
   thing worth building.
2. **Location list** — currently placeholder data pending Synergy's CSV.
3. **Password reset** — no self-service reset flow; an admin re-issues a password.
   Supabase email reset can be enabled once an SMTP sender is configured.
4. **Product lines** — the schema is already generic (`product_type`); only the
   current line is exposed in the interface, per the brief.
5. **Reports** page loads up to 20,000 rows per view and says so when it caps;
   beyond that, move the aggregation server-side.

## 8. Chart colours

The dashboard palette was validated for colour-blind separation and contrast
against the white card surface (blue `#2a78d6`, orange `#eb6834`, aqua `#1baf7a`,
yellow `#eda100`; critical red `#d03b3b` for overdue). Every series also carries a
visible label or legend value, so colour is never the only signal.
