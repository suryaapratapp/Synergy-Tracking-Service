/**
 * What has been done on this phone, newest first - shown on the home screen as
 * "Recent" so a fitter can see their own work at a glance (and whether it has
 * reached the server yet). Kept per person: the guest login's list is the guests',
 * a staff account's is that account's.
 */

import { useSyncExternalStore } from 'react'
import { kvGet, kvSet } from './db'
import { getQueueOwner } from './queue'

export type ActivityKind = 'install' | 'replace' | 'takedown'

export interface ActivityEntry {
  id: string
  at: string
  kind: ActivityKind
  code: string
  /** Where it was, short. */
  place?: string
  /** The queued job this belongs to, to tell whether it has been sent. */
  opId: string
  owner: string
}

const KEY = 'activity'
const MAX = 60

let entries: ActivityEntry[] = []
let loaded: Promise<void> | null = null
const listeners = new Set<() => void>()
let snapshot: ActivityEntry[] = []

function publish() {
  snapshot = entries.filter((e) => e.owner === getQueueOwner())
  listeners.forEach((l) => l())
}

function load(): Promise<void> {
  if (!loaded) {
    loaded = kvGet<ActivityEntry[]>(KEY)
      .then((rows) => {
        entries = rows ?? []
        publish()
      })
      .catch(() => undefined)
  }
  return loaded
}
void load()

/** The list depends on who is signed in, so refresh it when that changes. */
export function activityOwnerChanged() {
  publish()
}

export async function logActivity(e: Omit<ActivityEntry, 'id' | 'at' | 'owner'>) {
  await load()
  entries = [
    { ...e, id: `${e.opId}:${e.code}`, at: new Date().toISOString(), owner: getQueueOwner() },
    ...entries.filter((x) => !(x.opId === e.opId && x.code === e.code)),
  ].slice(0, MAX)
  publish()
  await kvSet(KEY, entries)
}

export function useActivity(): ActivityEntry[] {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => snapshot,
    () => snapshot,
  )
}

/** Local midnight, for "today". */
export function startOfToday(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}
