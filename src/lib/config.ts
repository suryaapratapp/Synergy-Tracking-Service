/**
 * Supabase connection details.
 *
 * Host environment variables win wherever they are set, so a staging site or a
 * second project needs no code change. The fallbacks below keep the app
 * building and deploying with no dashboard configuration at all.
 *
 * These two values are *public by design*. A browser client cannot connect
 * without them, so they are compiled into the JavaScript bundle and served to
 * every visitor whatever we do here — putting them in the repository changes
 * nothing about who can read them. They also grant nothing on their own: every
 * table, view and function denies the anonymous role, so an unauthenticated
 * request gets 401.
 *
 * The service role key is the one that matters, and it is never in this
 * repository — Supabase injects it into the edge function at runtime.
 *
 * Passwords and any other real secret belong in CREDENTIALS.local.md, which is
 * git-ignored.
 */

const FALLBACK_URL = 'https://dnesiqubviwvuavyestr.supabase.co'
const FALLBACK_ANON_KEY = 'sb_publishable_ITKkHrBMzHOe5JUT3RzFqQ_PZCSztRu'

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL?.trim() || FALLBACK_URL
export const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() || FALLBACK_ANON_KEY
