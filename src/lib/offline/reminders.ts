/**
 * "Jobs are waiting" reminders.
 *
 * Jobs done with no signal are safe on the phone, but they are only sent while the
 * app is open. If a fitter gets signal and simply forgets to open it, nothing would
 * ever tell them. So while any job is waiting, the phone shows a notification -
 * after 15 minutes, and then every hour - until the queue is empty, which cancels it.
 *
 * Only on the Android app (a browser cannot do this). If notifications are switched
 * off, nothing breaks: the banner and the sign-out warning still apply.
 */

import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'

const ID = 4711
let asked = false
let chain: Promise<void> = Promise.resolve()

/** A short trail of what the reminder did, readable from the app's debug console. */
function trace(msg: string) {
  const w = window as unknown as { __reminderLog?: string[] }
  w.__reminderLog = [...(w.__reminderLog ?? []).slice(-19), `${new Date().toISOString().slice(11, 19)} ${msg}`]
}

async function apply(waiting: number): Promise<void> {
  if (!Capacitor.isNativePlatform()) return trace('not native')

  if (waiting <= 0) {
    await LocalNotifications.cancel({ notifications: [{ id: ID }] })
    return trace('cancelled')
  }

  let perm = await LocalNotifications.checkPermissions()
  if (perm.display === 'prompt' || perm.display === 'prompt-with-rationale') {
    if (asked) return trace('permission not given yet')
    asked = true
    perm = await LocalNotifications.requestPermissions()
  }
  if (perm.display !== 'granted') return trace(`permission ${perm.display}`)

  await LocalNotifications.cancel({ notifications: [{ id: ID }] })
  await LocalNotifications.schedule({
    notifications: [
      {
        id: ID,
        title: 'Tex-Trak: jobs waiting to be sent',
        body: `${waiting} job${waiting === 1 ? '' : 's'} saved on this phone. Open Tex-Trak when you have signal to send ${waiting === 1 ? 'it' : 'them'}.`,
        // Not exact: it does not need to fire at a precise second, and exact alarms need a restricted permission.
        isExactNotification: false,
        schedule: { at: new Date(Date.now() + 15 * 60_000), every: 'hour' },
      },
    ],
  })
  trace(`scheduled for ${waiting}`)
}

/**
 * Keeps one reminder scheduled while `waiting` is more than zero. Safe to call
 * repeatedly: calls run one after another so a late "zero" can never undo a newer "two".
 */
export function syncReminder(waiting: number): Promise<void> {
  chain = chain.then(() => apply(waiting)).catch((e) => trace(`failed: ${String((e as Error)?.message ?? e)}`))
  return chain
}
