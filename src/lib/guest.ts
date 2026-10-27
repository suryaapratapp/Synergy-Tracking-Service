/**
 * Guests share one login, so the person behind it is just a typed name. It is
 * kept on the device and sent with every install / take-down, where the
 * database stores it as the installer / remover.
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

/**
 * Extra RPC argument naming the guest. Staff accounts send nothing: the
 * database ignores the name for anyone who is not signed in as the guest.
 */
export function actorArgs(): { p_actor_name?: string } {
  const name = readGuestName()
  return name ? { p_actor_name: name } : {}
}
