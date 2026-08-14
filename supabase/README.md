# Supabase backend

> The project reference, URL and keys are deliberately not recorded in this
> repository. They live in `.env` (git-ignored) locally and in the deployment
> host's environment variables. Substitute `<project-ref>` below.

## Schema

The schema is already applied to the project and its full migration history is
stored there. To bring a byte-exact copy into this folder (needs the Supabase CLI
and one `supabase login`):

```bash
supabase link --project-ref <project-ref> && supabase db pull
```

Applied migrations, grouped by what they do:

| Group | What it does |
|---|---|
| `core_schema` | Enums, `hospitals` / `wards` / `bays`, `profiles`, `products`, `installations`, `product_events`, `app_settings`, indexes |
| `rls_and_helpers` | Role helper functions, the `auth.users` → `profiles` trigger, RLS on every table and all policies |
| `views_and_workflow_rpcs` | `v_products`, `v_installations`, `v_locations`; `rpc_register_product`, `rpc_install_product`, `rpc_takedown` |
| `dashboard_and_import_rpcs` | `rpc_dashboard`, `rpc_import_locations`, `rpc_set_product_status` |
| `harden_function_grants` | Revokes every grant from `anon`; re-grants only what `authenticated` needs |
| `username_login`, `keep_username_and_auth_in_sync` | Username sign-in, and the trigger that keeps `profiles.username` and the auth record from drifting apart |
| `qr_code_generator`, `serial_code_format` | Label code minting and the `code_counters` table that guarantees serials are never reused |
| `enforce_house_code_prefix` | `is_house_code` plus the `products_house_code` constraint — only our own labels are accepted |
| `add_synergy_field_role`, `synergy_field_permissions` | The Synergy field role and `can_view_reports` |
| `seed_*` | Placeholder locations, the demonstration products and their lifecycle history |

Every `seed_*` migration is demonstration data only. See
[../docs/HANDOVER.md](../docs/HANDOVER.md) for how to clear it before go-live.

## Edge function

`functions/admin-create-user` backs **Users & settings → Add user**. Creating an
auth user requires the service role key, so the call is made here rather than in
the browser; the function verifies the caller's JWT belongs to an active admin
before it does anything.

Deploy:

```bash
supabase functions deploy admin-create-user --project-ref <project-ref>
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by the platform — the
service role key is never stored in this repository.
