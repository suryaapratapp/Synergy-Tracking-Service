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

### The five roles

| Role | Sees | Reports |
|---|---|---|
| **Administrator** | Everything, plus QR labels, users and settings | Yes |
| **Synergy** | All sites and all products | Yes |
| **Synergy field** | All sites — install, take down, register, locations | **No** |
| **Hospital** | Its own hospital only | Yes, scoped to that site |
| **Guest** | Install and take down at any site, under a typed name | No |

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

### Guest access (for fitters)

The sign-in screen opens on **Guest**: a fitter types their name and is working
straight away, with no username or password. Under the hood this is one shared
account, `guest`, whose role can do exactly two things — **install** and
**take down** (including the one-scan swap). The overview, products, reports,
labels, locations and settings are refused by the database, not just hidden:
the dashboard and count functions raise *"Guests cannot view the overview"*, and
every write other than install / take-down is blocked by row level security.

- **Who did it:** the typed name is sent with each install / take-down and stored
  with it (`installations.installed_by_label` / `removed_by_label`, and in the
  event log). Products and history screens show it wherever an installer or
  remover is named. A guest action with no name is rejected.
- **Home screen:** staff see four big buttons — Dashboard, Install, Take down,
  Products. A guest sees the same four, with Dashboard and Products locked.
- **Switch it off:** Users & settings → *Guest login (shared)* → untick *Guest
  access is switched on*. Takes effect immediately, including for guests who are
  already signed in.
- **Trade-off to be aware of:** the guest password is compiled into the app
  (`src/lib/config.ts`) — it has to be, for sign-in to need no typing — so anyone
  who has the app or the public repository can use guest access. That is the
  intended convenience, and it is why the guest role is limited as above; but a
  guest can still read and change installation records at every site. If that is
  too open for production, switch guest access off, or ask for it to be scoped to
  a PIN or a single site. To rotate the password, change it in Supabase Auth and
  in `config.ts`, then ship a new build.
- A guest's name lives on the device. Signing out (or **Exit**) clears it.

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
`RZCIR-<product code>-AAAAXXXX`, e.g. `RZCIR-MVN191-AAAA0001` — a product code
(MVN191 for the current curtain line) then four letters and four digits. Choose the product and a quantity (up to 500 per
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

**Stock is held as boxes.** Synergy packs already-labelled product into a box,
invoices it to a hospital and ships it; the items inside are scanned and
installed on arrival. So the **In stock** tab counts boxes, not loose items, and
shows them grouped by *In stock → Dispatched → Delivered* with quantity, invoice
reference and destination.

> This section is placeholder data (`public.stock_boxes`). `box_code` is where
> Synergy's own inventory barcode will land when the two systems are connected —
> nothing else in the app depends on it, so swapping the source is contained.

> **Open question:** the **Register labels** screen still exists and describes
> scanning each item onto the system at the Synergy site — a step that no longer
> happens now that the label generator creates the product records. It is
> harmless (useful for onboarding stock labelled elsewhere) but it contradicts
> the workflow above. Say the word and I will remove it.

**Install** — the fitter picks Hospital → Floor → Ward → Bay once, then scans each
product into that bay. Date and installer are recorded automatically and the
change-due date is set to **180 days** (configurable in Users & settings, and
overridable per install). The chosen location is remembered between visits.

**Take down** — two routes, because both happen in practice. **By scan** is the
default:
- *By scan*: scan the product coming down; it is logged straight away with the
  chosen reason.
- *By location*: pick the bay, tick what is coming down, choose a reason, confirm.

**Swapping — take down and hang up in one motion.** The moment anything comes
down, a *Hang the replacement* card appears on the same screen with the bay
already known. Scan the new label and it goes up in that exact bay, recorded as
the replacement for what came down. Several can come down first; they queue and
are replaced in order.

In *By scan* mode one scan field does both jobs, decided by the product itself:
a label that is still hanging is taken down, a label that is not is hung as the
replacement. With a hardware scanner or tap-free on, a swap is **scan old, scan
new** with nothing to tap in between.

It works the other way too. After an install, a card shows what is in that bay
(and how many are overdue) with **Take down in this bay**, which opens Take down
already set to that bay. Taking something down from a product's own page offers
**Hang the replacement in this bay**, which opens Install locked to that bay.

Every swap is linked in the data (`installations.replaces_installation_id`), so
the history reads *"Replaced by RZCIR-…"* / *"Hung as the replacement for
RZCIR-…"* and the activity feed says *"was installed, replacing RZCIR-…"*. The
database refuses a replacement that is in a different bay, that is hung before
the old one is down, or that replaces the same take-down twice.

Reasons are **Expired** (default), **Soiled**, **Damage**.

**Dashboard / Reports** — live counts, overdue and due-soon lists, fleet
composition, 12-month install vs take-down trend, reasons breakdown, per-hospital
and per-ward views, average service life, and CSV export from both Products and
Reports.

## 3. Data model

| Table | Purpose |
|---|---|
| `hospitals`, `wards`, `bays` | The location list (`wards.floor` carries the floor) |
| `products` | One row per labelled item; `qr_code` is unique, `product_code` (MVN191) and `product_type` keep the model open for future product lines |
| `installations` | One row per install→take-down cycle, with reason and notes |
| `product_events` | Append-only audit trail of everything that happened |
| `stock_boxes` | Boxed stock awaiting dispatch, in transit, or delivered — placeholder until Synergy's inventory system is connected |
| `code_counters` | The label serial per product line; never rewinds, which is what makes codes unrepeatable |
| `profiles` | Role and hospital scope, linked to the auth user |
| `app_settings` | `default_change_due_days` (180) and `product_line` |

A partial unique index guarantees a product can only have one live installation
at a time, so double-installs are impossible rather than merely discouraged.

Reads go through the `v_products`, `v_installations` and `v_locations` views.
Writes go through `rpc_register_product`, `rpc_install_product`,
`rpc_install_replacement`, `rpc_takedown`, `rpc_import_locations` and
`rpc_set_product_status`, each of which re-checks the
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
> `RZCIR-MVN191-…`, so the rule matches the fixed **`RZCIR`** prefix originally
> specified — which accepts both spellings. A literal six-character `RZCIRC`
> match would have rejected every code the system mints.

**Existing labels are migrated whenever the format changes**, so nothing in the
field is orphaned: `SYN-100023` → `RZCIR-CURT-100023` → serial format →
`RZCIR-MVN191-AAAA0001`. Each migration keeps history intact and carries the
serial counter across so numbering continues rather than restarting.

## 4. Security

- Row level security is on for every table; nothing is readable before sign-in.
- The `anon` role has no rights at all — verified by direct API calls.
- Hospital logins are pinned to their own site in the database. Asking the API
  for another hospital's products returns nothing; the dashboard RPC ignores a
  hospital filter it is not entitled to.
- Only Synergy and Admin can register products or import locations.
- Only Admin can create accounts or change roles.
- The shared Guest login can install and take down only; everything else is refused in the database (see *Guest access* above).

**Outstanding:** enable *Leaked password protection* in
Supabase → Authentication → Policies. It is off by default and checks new
passwords against HaveIBeenPwned. Worth switching on once real passwords are set.

## 5. Demo data

**Cleared on 27 Oct 2026.** Every product, QR label, installation, history
event and stock box was removed, ready for real use. Kept: all logins, the three
hospitals with their wards and bays (hospital logins point at them), and the
label serial counter.

The counter is deliberately **not** reset. Codes are never reused, so the next
labels the admin generates carry on from where the demo left off rather than
repeating a code that a printed test label might still carry. If you are certain
no test label exists anywhere and want numbering to restart at `AAAA0001`:

```sql
update public.code_counters set last_serial = 0;
```

The three placeholder hospitals (Queen Mary, St Thomas General, Royal Albert) and
their wards and bays are stand-ins until Synergy's real location list arrives —
import it under **Locations**, then remove any placeholders that are not wanted.

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
