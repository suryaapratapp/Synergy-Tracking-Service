/**
 * Who this phone last knew was signed in, and - for the shared guest login - a
 * way to check the PIN with no signal.
 *
 * The PIN is never stored. After a successful online sign-in the phone keeps a
 * salted PBKDF2 hash of it, which is enough to recognise the same PIN later
 * without a server. That makes the PIN a gate on the app, not a vault: it
 * stops a casual user, not someone with the phone and time to guess a short
 * number. The server still checks the PIN on every online sign-in, and a PIN
 * change reaches a phone the next time it connects.
 */

import type { Profile } from '../types'

const IDENTITY_KEY = 'tex-trak.identity'
const GUEST_PROFILE_KEY = 'tex-trak.guestProfile'
const PIN_KEY = 'tex-trak.pinVerifier'
const LOCK_KEY = 'tex-trak.pinLock'

const ITERATIONS = 150_000
const MAX_TRIES = 5
const LOCK_MS = 60_000

export const PIN_MIN = 4
export const PIN_MAX = 8

export function isValidPin(pin: string): boolean {
  return new RegExp(`^\\d{${PIN_MIN},${PIN_MAX}}$`).test(pin)
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage full or blocked - offline sign-in simply will not be available */
  }
}

/* ------------------------------------------------------- remembered profile */

/** The signed-in account, so a phone with no signal can still open the app. */
export function saveIdentity(profile: Profile) {
  write(IDENTITY_KEY, profile)
  if (profile.role === 'guest') write(GUEST_PROFILE_KEY, profile)
}

export function loadIdentity(): Profile | null {
  return read<Profile>(IDENTITY_KEY)
}

/** Signing out forgets the person but keeps what the shared guest login needs. */
export function clearIdentity() {
  write(IDENTITY_KEY, null)
}

export function loadGuestProfile(): Profile | null {
  return read<Profile>(GUEST_PROFILE_KEY)
}

/* ------------------------------------------------------------------- PIN */

interface Verifier {
  salt: string
  hash: string
  iterations: number
}

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

async function derive(pin: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, [
    'deriveBits',
  ])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    256,
  )
  return new Uint8Array(bits)
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

/** Remember this PIN (after the server has just accepted it). */
export async function rememberPin(pin: string): Promise<void> {
  if (!globalThis.crypto?.subtle) return
  try {
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const hash = await derive(pin, salt, ITERATIONS)
    write(PIN_KEY, { salt: b64(salt), hash: b64(hash), iterations: ITERATIONS } satisfies Verifier)
    write(LOCK_KEY, null)
  } catch {
    /* no offline PIN on this device */
  }
}

export function forgetPin() {
  write(PIN_KEY, null)
}

export function hasRememberedPin(): boolean {
  return read<Verifier>(PIN_KEY) !== null && loadGuestProfile() !== null
}

export type PinCheck =
  | { result: 'ok' }
  | { result: 'wrong'; triesLeft: number }
  | { result: 'locked'; seconds: number }
  | { result: 'unknown' }

/** Compares a typed PIN with the remembered one. Rate-limited on the phone. */
export async function checkPin(pin: string, opts: { count?: boolean } = {}): Promise<PinCheck> {
  const verifier = read<Verifier>(PIN_KEY)
  if (!verifier || !globalThis.crypto?.subtle) return { result: 'unknown' }

  const lock = read<{ fails: number; until: number }>(LOCK_KEY) ?? { fails: 0, until: 0 }
  if (lock.until > Date.now()) {
    return { result: 'locked', seconds: Math.ceil((lock.until - Date.now()) / 1000) }
  }

  const candidate = await derive(pin, unb64(verifier.salt), verifier.iterations)
  if (sameBytes(candidate, unb64(verifier.hash))) {
    write(LOCK_KEY, null)
    return { result: 'ok' }
  }

  // An online attempt only asks "has the PIN changed since?" - it must not use up the offline tries.
  if (opts.count === false) return { result: 'wrong', triesLeft: MAX_TRIES - lock.fails }

  const fails = lock.fails + 1
  if (fails >= MAX_TRIES) {
    write(LOCK_KEY, { fails: 0, until: Date.now() + LOCK_MS })
    return { result: 'locked', seconds: LOCK_MS / 1000 }
  }
  write(LOCK_KEY, { fails, until: 0 })
  return { result: 'wrong', triesLeft: MAX_TRIES - fails }
}
