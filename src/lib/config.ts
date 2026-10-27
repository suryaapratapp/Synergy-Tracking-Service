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

/**
 * The shared guest login behind "Continue as guest". A fitter types their name
 * and is signed in as this account, which can only install and take down - it
 * cannot see the overview, products or reports, and cannot change anything
 * else (enforced in the database, not just hidden in the interface).
 *
 * Like the publishable key above this ships in the bundle by design, so it is
 * not a secret. To switch guest access off, deactivate the "guest" user under
 * Users & settings; to rotate it, change the password in Supabase Auth and
 * here, then ship a new build.
 */
export const GUEST_USERNAME = 'guest'
export const GUEST_PASSWORD = 'vlF3Q9I5x6r00YDRpTwj75NCVXwl'
