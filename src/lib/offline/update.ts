/**
 * "Update now": the one routine behind the refresh icon in the header and the
 * Update button on the home screen. It re-checks the connection, refreshes the
 * site and product lists kept on the phone, and sends anything saved while offline.
 */

import { useSyncExternalStore } from 'react'
import { flush } from './queue'
import { checkNow, networkUsable } from './network'
import { syncSnapshot } from './snapshot'

export type UpdateResult = 'ok' | 'fail' | 'offline' | null

interface UpdateState {
  busy: boolean
  result: UpdateResult
}

let state: UpdateState = { busy: false, result: null }
const listeners = new Set<() => void>()
let clearTimer: ReturnType<typeof setTimeout> | undefined

function set(next: UpdateState) {
  state = next
  listeners.forEach((l) => l())
}

export function useUpdateState(): UpdateState {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => state,
    () => state,
  )
}

/** Runs an update. `reload` refreshes the site list held in memory. Resolves with how it went. */
export async function runUpdate(reload: () => Promise<void>): Promise<UpdateResult> {
  if (state.busy) return state.result
  clearTimeout(clearTimer)
  set({ busy: true, result: null })

  let result: UpdateResult = 'ok'
  await checkNow()
  if (!networkUsable()) {
    result = 'offline'
  } else {
    await reload()
    const ok = await syncSnapshot()
    result = ok ? 'ok' : 'fail'
    if (ok) void flush()
  }

  set({ busy: false, result })
  // Say what happened, then get out of the way.
  clearTimer = setTimeout(() => set({ busy: false, result: null }), result === 'ok' ? 8000 : 10_000)
  return result
}
