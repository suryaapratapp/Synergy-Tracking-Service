/**
 * Guests share one login, so the person behind it is just a typed name. It is
 * kept on the device and saved with every install / take-down job (see
 * lib/offline), where the database stores it as the installer / remover.
 */

const KEY = 'tex-trak.guestName'

export const MAX_GUEST_NAME = 60

export function cleanGuestName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_GUEST_NAME)
}

export function readGuestName(): string {
  try {
    return cleanGuestName(localStorage.getItem(KEY) ?? '')
  } catch {
    return ''
  }
}

export function storeGuestName(name: string) {
  try {
    if (name) localStorage.setItem(KEY, name)
    else localStorage.removeItem(KEY)
  } catch {
    /* private mode - the name just will not survive a reload */
  }
}
