# Supabase backend

Project ref: `dnesiqubviwvuavyestr` (eu-west-2)

## Schema

The schema is already applied to the project and its full migration history is
stored there. To bring a byte-exact copy into this folder (needs the Supabase CLI
and one `supabase login`):

```bash
supabase link --project-ref dnesiqubviwvuavyestr && supabase db pull
```

Applied migrations, in order:

| # | Migration | What it does |
|---|---|---|
| 1 | `core_schema` | Enums, `hospitals` / `wards` / `bays`, `profiles`, `products`, `installations`, `product_events`, `app_settings`, indexes |
| 2 | `rls_and_helpers` | Role helper functions, the `auth.users` → `profiles` trigger, RLS on every table and all policies |
| 3 | `views_and_workflow_rpcs` | `v_products`, `v_installations`, `v_locations`; `rpc_register_product`, `rpc_install_product`, `rpc_takedown` |
| 4 | `dashboard_and_import_rpcs` | `rpc_dashboard`, `rpc_import_locations`, `rpc_set_product_status` |
| 5–8 | `seed_test_locations*`, `seed_accounts`, `seed_demo_data` | Placeholder locations, the three logins, demonstration products |
| 9 | `harden_function_grants` | Revokes every grant from `anon`; re-grants only what `authenticated` needs |
| 10–11 | `seed_demo_history_*` | Reshapes the demo history into a realistic 2-week replacement cycle with no overlapping installations |

Migrations 5–8 and 10–11 are demonstration data only. See
[../docs/HANDOVER.md](../docs/HANDOVER.md) § 5 for how to clear them before
go-live.

## Edge function

`functions/admin-create-user` backs **Users & settings → Add user**. Creating an
auth user requires the service role key, so the call is made here rather than in
the browser; the function verifies the caller's JWT belongs to an active admin
before it does anything.

Deploy:

```bash
supabase functions deploy admin-create-user --project-ref dnesiqubviwvuavyestr
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by the platform — no
secrets to configure.
