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

The sign-in screen opens on **Guest**: a fitter types their name and a **PIN**
and is working straight away — no username or password to remember. Under the
hood this is one shared account, `guest`, whose role can do exactly two things —
**install** and **take down** (including the one-scan swap). The overview,
products, reports, labels, locations and settings are refused by the database,
not just hidden: the dashboard and count functions raise *"Guests cannot view the
overview"*, and every write other than install / take-down is blocked by row
level security.

- **The PIN:** 4–8 digits, set by an administrator under Users & settings →
  *Guest login (shared)* → *Guest PIN*. It is the only secret: the guest
  account's real password is a fixed public prefix (`GUEST_PEPPER` in
  `src/lib/config.ts`, there so a short PIN still meets Supabase's minimum
  password length) followed by the PIN. The PIN cannot be read back, only
  replaced. Replacing it (`admin_set_guest_pin`) deletes the guest's sessions, so
  phones are signed out within about an hour, when their current token lapses.
  The initial PIN is in `CREDENTIALS.local.md` (git-ignored).
- **Who did it:** the typed name is saved with each install / take-down
  (`installations.installed_by_label` / `removed_by_label`, and in the event
  log). Products and history screens show it wherever an installer or remover is
  named. A guest action with no name is rejected.
- **Home screen:** staff see four big buttons — Dashboard, Install, Take down,
  Products. A guest sees the same four, with Dashboard and Products locked.
- **Switch it off:** Users & settings → *Guest login (shared)* → untick *Guest
  access is switched on*. Takes effect immediately for anyone online; a phone
  with no signal keeps working until it next connects.
- **Trade-offs:** a 4–6 digit PIN can be guessed by someone determined who is
  willing to hammer the sign-in endpoint (Supabase rate-limits it, which slows
  but does not stop that), so use 6–8 digits and rotate it when a fitter leaves.
  Any guest can still read and change installation records at every site; if that
  is too open, ask for it to be scoped per site.
- A guest's name lives on the device. Signing out (or **Exit**) clears it.

### Working offline

Hospital wards lose signal, so everything a fitter does on site works without it.
Nothing about the screens changes; the phone just keeps the work and sends it later.

| Works with no signal | Needs signal |
|---|---|
| Opening the app (installed Android app, or the web app after its first visit) | The first sign-in on each phone |
| **Guest sign-in with the PIN** | Dashboard, Products, Reports, Labels, Admin |
| Scanning (camera, hardware scanner, typing) and the hospital → floor → ward → bay pickers | Seeing other people's changes made while you were offline |
| **Install, take down and the one-scan swap** | |

How it works (`src/lib/offline/`):

- **Saved first, sent second.** Every install / take-down is written to the phone's
  queue (`queue.ts`, IndexedDB) before anything goes to the server, then sent
  straight away if the network answers. A job is never lost to a dropped
  connection, a closed app or a dead battery.
- **In order.** Jobs are sent oldest first, so a take-down always lands before the
  replacement hung in its place.
- **Exactly once.** Each job carries its own id; the server (`client_ops`) applies
  a repeated job once, so retrying after a lost reply cannot double-book. An
  install's id *is* the installation's id, which is how a product installed and
  taken down entirely offline still hangs together.
- **When it really happened.** Each job carries the time the fitter did it
  (`p_occurred_at`). The server accepts it only within the last 45 days and never
  in the future, so a wrong phone clock cannot rewrite history.
- **The phone's own copy** (`snapshot.ts`): the site list and every product's
  state, downloaded after sign-in and topped up with only what changed. Scans are
  checked against it with no signal — a repeat install, a retired label or "not
  installed" is caught on the spot. Jobs done offline are applied to it
  immediately so the next scan sees them. It is only a guide: if it is stale and
  the server disagrees, the server wins (below).
- **When the server says no.** A refused job (someone else installed it first, the
  label was retired) is kept, shown in a red banner with the reason, and can be
  dismissed or retried; the phone's copy is corrected from the server. Nothing
  disappears silently.
- **Offline PIN check** (`identity.ts`): after one online sign-in the phone keeps a
  salted PBKDF2 hash of the PIN. Offline, a typed PIN is compared with it; five
  wrong tries lock it for a minute. It is a gate on the app, not a vault — someone
  holding the phone with time to spare could guess a short PIN against that hash.
  A PIN change reaches a phone the next time it connects; until then the old PIN
  still opens the app on that phone.
- **Signing in properly afterwards.** Signed in offline, the app signs in with the
  server by itself once signal returns (holding the PIN in memory only) and sends
  the queue. If it cannot (the PIN has since changed), the fitter is asked to
  sign in again; the saved jobs stay on the phone and go through afterwards.
- **Banner and home card.** A strip under the header says *Offline* / *Sending N
  saved jobs* / *N could not be saved*; tapping it lists them. The home screen
  shows *Ready for no signal* once the site and product lists are on the phone.
- **Leaving with unsent jobs.** *Exit* warns first. The jobs stay on the phone and
  are sent the next time someone signs in with signal.

Not covered: Dashboard / Products / Reports (they need live data), and a *brand
new* label that was registered after the phone's last sync is accepted offline
without a check and verified by the server when it connects.

For developers: in `npm run dev`, `localStorage['dev.offline'] = '1'` makes every
server request fail like a dead connection and survives reloads — the practical
way to test "reopen the app with no signal". It is compiled out of production builds.

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
`RZCIR-<product code>-AAA999`, e.g. `RZCIR-MVN191-AAA001` — a product code
(MVN191 for the current curtain line) then three letters and three digits. Choose the product and a quantity (up to 500 per
click), press generate, then download the CSV for the label printer or print a
ready-made sheet of 28 × 34 mm labels. Each label carries the QR with the code
printed underneath, so a damaged label can still be typed in. A preview of the
exact label is shown before generating.

**Codes are issued in ascending serial order and are never reused.** The order
runs `AAA001 → AAA999 → AAB001 → …`, giving 17,558,424 codes per product
line (26³ letter blocks × 999 numbers); the database refuses to issue past that
rather than repeat. Each product line keeps its own series (`RZCIR-BEDS-AAA001`
starts fresh). Scans and registration only require the `RZCIR` prefix, so a label
in the earlier 4-letter / 4-digit format is still recognised.

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
`RZCIR-MVN191-AAAA0001` → `RZCIR-MVN191-AAA001` (27 Oct 2026, when the database
held no labels, so the counter restarted at zero). Earlier migrations kept
history intact and carried the serial counter across.

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

When the code format changed to 3 letters + 3 digits the counter was reset, so
the first label generated is `RZCIR-MVN191-AAA001`. A code in the old 4+4 format
can never equal a 3+3 code, so nothing can repeat. From here on the counter never
rewinds — if you ever wipe test data again, leave it alone so a printed test label
cannot be reissued. (Only if you are certain none exists: `update public.code_counters set last_serial = 0;`)

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

1. **Offline** — install, take-down, scanning and guest sign-in work with no signal
   (see *Working offline*). Staff-only screens still need a connection.
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
