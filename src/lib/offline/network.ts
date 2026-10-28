/**
 * "Is the network actually working?" - not the same as `navigator.onLine`,
 * which stays true on a phone with a full-bars signal and no data, or on a
 * hospital Wi-Fi that needs a login.
 *
 * Every request reports how it went. After a failure the app stops waiting on
 * the network for a short while and answers from the phone instead, so a scan
 * is never held up by a dead connection. A success, or the browser saying the
 * connection is back, clears it immediately.
 */

import { useSyncExternalStore } from 'react'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../config'
import { deviceFetch } from './deviceFetch'

const COOL_OFF_MS = 20_000
const PROBE_EVERY_MS = 10_000

let failedAt = 0
const listeners = new Set<() => void>()

export function reportNetwork(ok: boolean) {
  const wasDown = failedAt !== 0
  failedAt = ok ? 0 : Date.now()
  if (wasDown === ok) listeners.forEach((l) => l())
  if (!ok) startProbing()
}

let probeTimer: ReturnType<typeof setInterval> | null = null

/**
 * While the network is marked down, quietly knock on the server's door so the
 * app notices the moment it is back - even when nothing else is being sent.
 * Any HTTP answer at all (even a refusal) proves the server can be reached.
 */
function startProbing() {
  if (probeTimer || typeof window === 'undefined') return
  probeTimer = setInterval(async () => {
    if (failedAt === 0) {
      clearInterval(probeTimer!)
      probeTimer = null
      return
    }
    if (navigator.onLine === false) return
    try {
      const ctl = new AbortController()
      const timer = setTimeout(() => ctl.abort(), 5000)
      await deviceFetch(`${SUPABASE_URL}/auth/v1/health`, {
        headers: { apikey: SUPABASE_ANON_KEY },
        cache: 'no-store',
        signal: ctl.signal,
      }).finally(() => clearTimeout(timer))
      reportNetwork(true)
    } catch {
      /* still down */
    }
  }, PROBE_EVERY_MS)
}

/** One quick check of whether the server can be reached right now (used when no request is in flight to tell us). */
export async function checkNow(): Promise<void> {
  if (navigator.onLine === false) {
    reportNetwork(false)
    return
  }
  try {
    await withTimeout(
      (signal) =>
        deviceFetch(`${SUPABASE_URL}/auth/v1/health`, {
          headers: { apikey: SUPABASE_ANON_KEY },
          cache: 'no-store',
          signal,
        }),
      4000,
    )
    reportNetwork(true)
  } catch {
    reportNetwork(false)
  }
}

/** For screens: true while the app believes it can reach the server. */
export function useNetworkUsable(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const stop = onNetworkChange(notify)
      window.addEventListener('online', notify)
      window.addEventListener('offline', notify)
      return () => {
        stop()
        window.removeEventListener('online', notify)
        window.removeEventListener('offline', notify)
      }
    },
    () => networkUsable(),
    () => true,
  )
}

/** True when it is worth trying the network right now. */
export function networkUsable(): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false
  return failedAt === 0 || Date.now() - failedAt > COOL_OFF_MS
}

export function onNetworkChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => reportNetwork(true))
  window.addEventListener('offline', () => reportNetwork(false))
}

/** Does this error mean "could not reach the server" rather than "the server said no"? */
export function isNetworkError(err: unknown): boolean {
  const e = err as { message?: string; name?: string; status?: number } | null
  if (!e) return false
  if (e.name === 'AuthRetryableFetchError' || e.name === 'AbortError') return true
  if (e.status === 0) return true
  return /failed to fetch|networkerror|network request failed|load failed|timed out|timeout|abort|fetch failed|err_internet|offline/i.test(
    e.message ?? '',
  )
}

/**
 * Runs a request with a deadline; a hang counts as a network failure.
 *
 * The call itself is raced against the clock as well as aborted, because the
 * time can also be spent before any request exists - the client waits for a
 * sign-in token to refresh - and an abort signal cannot interrupt that.
 */
export async function withTimeout<T>(
  run: (signal: AbortSignal) => PromiseLike<T>,
  ms = 8000,
): Promise<T> {
  const ctl = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctl.abort()
      const err = new Error('The connection timed out')
      err.name = 'AbortError'
      reject(err)
    }, ms)
  })
  try {
    return await Promise.race([run(ctl.signal), deadline])
  } finally {
    clearTimeout(timer)
  }
}

/** Resolves with the fallback instead of waiting longer than `ms`. */
export async function orAfter<T>(work: PromiseLike<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms)
  })
  try {
    return await Promise.race([work, late])
  } finally {
    clearTimeout(timer)
  }
}
