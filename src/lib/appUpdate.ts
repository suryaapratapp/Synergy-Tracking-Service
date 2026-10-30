/**
 * Live updates: fixing the app on a phone that already has it, without a new APK.
 *
 * The app's screens (everything except the small native shell) are a bundle of files.
 * Phones compare their own version with the newest row in `app_releases`; if they are
 * behind, they download that bundle (a zip in the repo's ota/ folder), keep it, and
 * restart into it. See docs/HANDOVER.md, "Fixing the app without a new APK".
 *
 * Safety:
 *  - A new version must call notifyAppReady() soon after it starts. If it does not (it
 *    crashes, or shows a blank screen) the phone drops it and goes back to the last
 *    version that worked, by itself.
 *  - A version that failed that way is remembered and not tried again on this phone.
 *  - A bundle is only used if its fingerprint (sha256) matches the one published.
 *  - Only runs inside the Android app, and only over https.
 */

import { Capacitor } from '@capacitor/core'
import { CapacitorUpdater } from '@capgo/capacitor-updater'
import { supabase } from './supabase'
import { withTimeout } from './offline/network'

const PENDING_KEY = 'tex-trak.otaPending'
const BAD_KEY = 'tex-trak.otaBad'

interface Release {
  version: string
  url: string
  sha256: string | null
  min_native: string
  notes: string | null
}

/** 1.10.2 > 1.9.9. Missing parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d < 0 ? -1 : 1
  }
  return 0
}

function readList(key: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '[]') as string[]
  } catch {
    return []
  }
}

function writeKey(key: string, value: string | string[] | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value))
  } catch {
    /* storage unavailable - the worst case is an extra download */
  }
}

/**
 * Call once at start-up. Tells the plugin this version came up fine (so it is kept), and
 * works out whether the version we just tried was kept or thrown away.
 */
export async function appStarted(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    await CapacitorUpdater.notifyAppReady()
  } catch {
    /* nothing to confirm */
  }

  const pending = localStorage.getItem(PENDING_KEY)
  if (!pending) return
  writeKey(PENDING_KEY, null)
  if (pending !== __APP_VERSION__) {
    // We were asked to run `pending` but are running something else: it was rolled back.
    writeKey(BAD_KEY, [...new Set([...readList(BAD_KEY), pending])].slice(-20))
  }
}

async function newestUsable(native: string): Promise<Release | null> {
  const { data, error } = await withTimeout(
    (signal) =>
      supabase
        .from('app_releases')
        .select('version,url,sha256,min_native,notes')
        .order('created_at', { ascending: false })
        .limit(10)
        .abortSignal(signal),
    8000,
  )
  if (error || !data) return null
  const bad = readList(BAD_KEY)
  return (
    (data as Release[]).find(
      (r) =>
        compareVersions(r.version, __APP_VERSION__) > 0 &&
        compareVersions(r.min_native, native) <= 0 &&
        !bad.includes(r.version) &&
        r.url.startsWith('https://'),
    ) ?? null
  )
}

export type AppUpdate =
  | { state: 'none' }
  | { state: 'ready'; version: string; apply: () => Promise<void>; applyLater: () => Promise<void> }
  | { state: 'failed'; reason: string }

/**
 * Looks for a newer version and, if there is one, downloads it. It is not switched on
 * until `apply()` (restart now) or `applyLater()` (next time the app is closed or reopened).
 */
export async function findAppUpdate(): Promise<AppUpdate> {
  if (!Capacitor.isNativePlatform()) return { state: 'none' }
  try {
    const { native } = await CapacitorUpdater.current()
    const release = await newestUsable(native)
    if (!release) return { state: 'none' }

    const bundle = await CapacitorUpdater.download({
      url: release.url,
      version: release.version,
      ...(release.sha256 ? { checksum: release.sha256 } : {}),
    })
    return {
      state: 'ready',
      version: release.version,
      apply: async () => {
        writeKey(PENDING_KEY, release.version)
        await CapacitorUpdater.set({ id: bundle.id })
      },
      applyLater: async () => {
        writeKey(PENDING_KEY, release.version)
        await CapacitorUpdater.next({ id: bundle.id })
      },
    }
  } catch (e) {
    return { state: 'failed', reason: String((e as Error)?.message ?? e) }
  }
}

/** Quietly fetches a newer version when the app opens, to be used the next time it is opened. */
export function checkForAppUpdateInBackground(): void {
  if (!Capacitor.isNativePlatform()) return
  setTimeout(() => {
    void findAppUpdate().then((u) => {
      if (u.state === 'ready') void u.applyLater()
    })
  }, 8000)
}
