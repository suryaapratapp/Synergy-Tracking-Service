import { createClient } from '@supabase/supabase-js'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: 'synergy-auth',
  },
  global: { headers: { 'x-application-name': 'tex-trak' } },
})

/**
 * PostgREST caps every response at 1000 rows regardless of `.limit()`, which
 * would silently truncate reports and CSV exports. This pages through the
 * whole result set (up to `cap`) so totals and downloads are complete.
 */
export async function fetchAllRows<T>(
  makeQuery: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  cap = 20000,
): Promise<{ rows: T[]; truncated: boolean; error: { message: string } | null }> {
  const PAGE = 1000
  const rows: T[] = []
  let from = 0

  for (;;) {
    const to = Math.min(from + PAGE - 1, cap - 1)
    if (to < from) return { rows, truncated: true, error: null }

    const { data, error } = await makeQuery(from, to)
    if (error) return { rows, truncated: false, error }

    const batch = data ?? []
    rows.push(...batch)

    if (batch.length < to - from + 1) return { rows, truncated: false, error: null }
    if (rows.length >= cap) return { rows, truncated: true, error: null }
    from = to + 1
  }
}

/** Turns a Postgres/PostgREST error into something a fitter can act on. */
export function friendlyError(err: unknown): string {
  const e = err as { message?: string; code?: string; details?: string } | null
  if (!e) return 'Something went wrong. Please try again.'
  const msg = e.message ?? String(err)

  if (/failed to fetch|network|load failed/i.test(msg)) {
    return 'No connection. Check your signal and try again.'
  }
  if (/profiles_username_key/.test(msg)) return 'That username is already taken.'
  if (e.code === '23505' && /already registered|already taken/i.test(msg)) return msg
  if (e.code === '42501') return msg || 'You do not have permission to do that.'
  if (e.code === 'P0002') return msg
  if (/invalid login credentials/i.test(msg)) return 'Wrong username or password.'
  if (/email not confirmed/i.test(msg)) return 'This account has not been confirmed yet.'
  return msg
}
