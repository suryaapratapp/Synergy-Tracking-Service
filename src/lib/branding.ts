/** Product name in one place, so it is easy to rebrand later. */
export const APP_NAME = 'Tex-Trak'
export const APP_TAGLINE = 'Product lifecycle tracking for healthcare environments'
export const DEVELOPER = 'Developed by CIRCAI Ltd'

/**
 * Supabase Auth is keyed on email, but staff sign in with a username.
 * Each account carries a deterministic internal address built from its
 * username — nothing is ever sent to it, it is only an identifier.
 */
export const LOGIN_DOMAIN = 'synergy.local'

export function usernameToEmail(username: string): string {
  return `${username.trim().toLowerCase()}@${LOGIN_DOMAIN}`
}

export function emailToUsername(email: string | null | undefined): string {
  if (!email) return ''
  return email.split('@')[0]
}
