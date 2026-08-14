# Handover — Tex-Trak

Developed by CIRCAI Ltd.

> **This file is committed to the repository. Never put passwords, API keys or
> the Supabase project reference in it.** Credentials live in
> `CREDENTIALS.local.md`, which is git-ignored, and in the deployment host's
> environment variables.

---

## 1. Logins

Staff sign in with a **username** — no email address.

Usernames are `admin`, `synergy`, `synergy2`, and one per hospital. **Passwords
are not recorded here** — see `CREDENTIALS.local.md` on the delivery machine, or
ask the administrator.

### The four roles

| Role | Sees | Reports |
|---|---|---|
| **Administrator** | Everything, plus QR labels, users and settings | Yes |
| **Synergy** | All sites and all products | Yes |
| **Synergy field** | All sites — install, take down, register, locations | **No** |
| **Hospital** | Its own hospital only | Yes, scoped to that site |

**Synergy field** is for team members who do the fitting work but should not be
shown the reporting side. It is identical to Synergy in every other respect: the
same reach across every site, the same install / take-down / register screens.
Reports is removed from the navigation and the `/reports` address redirects home.

> Worth knowing: this is a **navigation-level** permission, not a data firewall.
> The take-down screen has to read installation records to list what is in a bay,
> so a field user's login can still reach that data through the API directly —
> it is only the Reports feature that is withheld. If you need a hard boundary
> (field staff able to read nothing beyond the bay they are working in), say so
> and I will scope their row-level access down; it is a larger change because it
> touches the take-down workflow.
>
> The Products screen still offers its CSV export to this role. I left it alone
> because you asked specifically about Reports — one line to remove it if you
> would rather they could not export either.

Supabase Auth is email-keyed underneath, so each account carries a deterministic
internal address `<username>@synergy.local`. Nothing is ever sent to it — it is
only an identifier, and staff never see or type it.

To add a hospital as Synergy onboards it: **Users & settings → Add user**, choose
a username, role *Hospital* and the site. Account creation runs through a Supabase
edge function that checks the caller is an admin before using the service key, so
the privileged key never reaches the browser.

**Changing your own password:** every user has **My account** in the navigation —
current password, new password, repeat, each with a *Show* toggle. The current
password is re-checked before the change is allowed, so an unattended phone is
not enough to take over an account. Changing it does not sign you out on the
device you are using.

**Renaming a user:** do it in **Users & settings → tap the user → Username**. The
change takes effect immediately — they sign in with the new name straight away.

> **Gap worth closing before go-live:** there is no password *reset*. Usernames
> are not real email addresses, so the "forgot password" route does not exist —
> if someone forgets their password, an admin cannot currently reset it from the
> app, and it takes a database change to recover the account. Adding an admin
> reset button is a small extension of the existing `admin-create-user` edge
> function; say the word and I will add it.

> Do not rename by editing `profiles.username` in the Supabase table editor and
> nothing else. A username exists in two places — `profiles.username` (what staff
> type) and `auth.users.email` (what Auth is keyed on) — and editing one alone
> used to lock the account out. A trigger, `profiles_sync_username`, now carries
> any change through to the auth record automatically, so a direct SQL rename is
> safe too; it also rejects duplicates and malformed usernames.

## 2. What the app does

**QR labels** (admin only) — generates label codes in the fixed format
`RZCIR-<first four letters of the product>-AAAAXXXX`, e.g. `RZCIR-CURT-AAAA0001`
— four letters then four digits. Choose the product and a quantity (up to 500 per
click), press generate, then download the CSV for the label printer or print a
ready-made sheet of 28 × 34 mm labels. Each label carries the QR with the code
printed underneath, so a damaged label can still be typed in. A preview of the
exact label is shown before generating.

**Codes are issued in ascending serial order and are never reused.** The order
runs `AAAA0001 → AAAA9999 → AAAB0001 → …`, giving 4,569,105,024 codes per product
line. Each product line keeps its own series (`RZCIR-BEDS-AAAA0001` starts fresh).

The counter lives in `public.code_counters`, not in the products table, which is
what makes "never reused" hold absolutely: deleting a product — or wiping the
entire demo dataset — does not rewind it, so a retired number can never come round
again. Blocks are reserved atomically, so two admins generating at once can never
be handed the same serial. Verified by deleting freshly issued codes and
confirming the next run skipped past them.

**Register** (Synergy only) — labels are applied at the Synergy site and each
product is scanned onto the system. Batch, size and colour are set once per run
and applied to every scan. A paste-a-list mode covers bulk labelling.

**Install** — the fitter picks Hospital → Floor → Ward → Bay once, then scans each
product into that bay. Date and installer are recorded automatically and the
change-due date is set to **180 days** (configurable in Users & settings, and
overridable per install). The chosen location is remembered between visits.

**Take down** — two routes, because both happen in practice. **By scan** is the
default:
- *By scan*: scan the product coming down; it is logged straight away with the
  chosen reason.
- *By location*: pick the bay, tick what is coming down, choose a reason, confirm.

Reasons are **Expired** (default), **Soiled**, **Damage**.

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

## 3a. Only our own labels are accepted

A phone camera reads any QR or barcode it is pointed at — a poster, a packet of
gloves, a delivery note. Anything whose code does not begin with **`RZCIR`** is
rejected before it can touch a product record, and the user sees
`<code> is not a valid product label`.

This is enforced in the database only, and is deliberately **not mentioned
anywhere in the interface**:

| Where | What it does |
|---|---|
| `public.is_house_code(text)` | The single rule — code must start with `RZCIR`, case-insensitive |
| `rpc_register_product` | Rejects before creating a product |
| `rpc_install_product` | Rejects before fitting |
| `rpc_takedown` | Rejects every scanned code before removing anything |
| `products_house_code` CHECK constraint | Backstop — blocks any direct insert or update, whatever route it arrives by |

Verified against real EAN-13 barcodes, URLs, plain text and the old code format;
all four paths reject them, including a direct API write that bypasses the RPCs.

To widen or change the accepted prefix later, edit `is_house_code` — every
enforcement point reads from it.

> Note on spelling: the request said "RZCIRC". The generator produces
> `RZCIR-CURT-…`, so the rule matches the fixed **`RZCIR`** prefix you originally
> specified — which accepts both spellings. A literal six-character `RZCIRC`
> match would have rejected every code the system mints.

**Demo data was migrated to suit this.** The 560 demonstration products were on
the old `SYN-100023` format and would have become unusable, so they were renamed
to `RZCIR-CURT-100023` (same trailing digits, history intact). One foreign
barcode, `525819075`, had been registered during testing; it had no history and
was removed.

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
