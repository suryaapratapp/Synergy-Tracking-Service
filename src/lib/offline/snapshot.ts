/**
 * The phone's own copy of what a fitter needs in a ward with no signal:
 *
 *  - the site list (hospital > floor > ward > bay), and
 *  - every product's current state - registered, hanging where, taken down.
 *
 * The product list is downloaded in full once, then topped up with only what
 * changed. Jobs done offline are applied to it straight away, so a scan
 * minutes later sees them. The server stays the authority: anything the phone
 * got wrong is corrected the next time it connects.
 */

import { supabase } from '../supabase'
import type { InstallationView, LocationRow, ProductView } from '../types'
import type { Place } from '../location'
import { dbCount, dbDelete, dbGet, dbGetAll, dbGetByIndex, dbPutMany, kvGet, kvSet } from './db'
import { isNetworkError, networkUsable, reportNetwork, withTimeout } from './network'

/** The slice of a product the offline screens need. */
export interface CachedProduct {
  qr_code: string
  id: string
  product_type: string
  product_code: string | null
  status: ProductView['status']
  installation_id: string | null
  installed_at: string | null
  due_date: string | null
  hospital_id: string | null
  hospital_name: string | null
  ward_id: string | null
  ward_name: string | null
  floor: string | null
  bay_id: string | null
  bay_name: string | null
  updated_at: string | null
}

const COLUMNS =
  'id,qr_code,product_type,product_code,status,installation_id,installed_at,due_date,hospital_id,hospital_name,ward_id,ward_name,floor,bay_id,bay_name,updated_at'

const META_KEY = 'product-sync'
const LOCATIONS_KEY = 'locations'
const CONFIG_KEY = 'config'
const FALLBACK_DUE_DAYS = 180

interface SyncMeta {
  /** Newest product change seen, used to ask only for what is newer. */
  cursor: string | null
  /** When this phone last finished a sync. */
  syncedAt: string | null
}

/* ---------------------------------------------------------------- listeners */

const listeners = new Set<() => void>()
export function onSnapshotChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
const changed = () => listeners.forEach((l) => l())

/* ---------------------------------------------------------------- locations */

export async function cacheLocations(rows: LocationRow[]) {
  await kvSet(LOCATIONS_KEY, rows)
}

export async function cachedLocations(): Promise<LocationRow[]> {
  return (await kvGet<LocationRow[]>(LOCATIONS_KEY)) ?? []
}

/* ------------------------------------------------------------------- config */

export async function defaultDueDays(): Promise<number> {
  return (await kvGet<{ default_due_days: number }>(CONFIG_KEY))?.default_due_days ?? FALLBACK_DUE_DAYS
}

/**
 * Is this one of our labels? Checked against the prefixes the server has ever
 * issued (kept on the phone). If the phone has never received them, say yes -
 * a wrong "no" would block a real label, while the server checks it properly later.
 */
export async function looksLikeOurCode(code: string): Promise<boolean> {
  const prefixes = (await kvGet<{ code_prefixes?: string[] }>(CONFIG_KEY))?.code_prefixes
  if (!prefixes || prefixes.length === 0) return true
  const upper = code.toUpperCase()
  return prefixes.some((p) => upper.startsWith(p.toUpperCase()))
}

async function refreshConfig() {
  const { data, error } = await withTimeout((signal) =>
    supabase.rpc('rpc_offline_config').abortSignal(signal),
  )
  if (!error && data) await kvSet(CONFIG_KEY, data)
}

/* ------------------------------------------------------------ product list */

export async function snapshotInfo(): Promise<{ syncedAt: string | null; count: number }> {
  const meta = await kvGet<SyncMeta>(META_KEY)
  return { syncedAt: meta?.syncedAt ?? null, count: await dbCount('products') }
}

let syncing: Promise<boolean> | null = null
const progressListeners = new Set<(rows: number) => void>()
let progressNow = 0

/**
 * Brings the phone's product list up to date. Safe to call often: it does
 * nothing without a working connection and never runs twice at once - a second
 * caller simply joins the one already running. `onProgress` is told how many
 * products have arrived so far, whoever started the download.
 */
export function syncSnapshot(onProgress?: (rows: number) => void): Promise<boolean> {
  if (!networkUsable()) return Promise.resolve(false)
  if (onProgress) {
    progressListeners.add(onProgress)
    onProgress(progressNow)
  }
  if (!syncing) {
    progressNow = 0
    syncing = doSync().finally(() => {
      syncing = null
    })
  }
  return syncing.finally(() => {
    if (onProgress) progressListeners.delete(onProgress)
  })
}

const PAGE = 1000
const PARALLEL = 6

function report(rows: number) {
  progressNow = rows
  progressListeners.forEach((l) => l(rows))
}

/**
 * The very first download: the id space is cut into 16 slices, each read in
 * order a page at a time, several slices at once. Much quicker than one long
 * queue for a phone that has nothing yet.
 */
async function downloadAll(): Promise<string | null> {
  const slices = '0123456789abcdef'.split('')
  const queue = [...slices]
  let received = 0
  let newest: string | null = null

  const worker = async () => {
    for (let hex = queue.shift(); hex !== undefined; hex = queue.shift()) {
      const lower = `${hex}0000000-0000-0000-0000-000000000000`
      const upper = hex === 'f' ? null : `${slices[slices.indexOf(hex) + 1]}0000000-0000-0000-0000-000000000000`
      let after: string | null = null
      for (;;) {
        let q = supabase.from('v_products').select(COLUMNS)
        q = after ? q.gt('id', after) : q.gte('id', lower)
        if (upper) q = q.lt('id', upper)
        const { data, error } = await withTimeout((signal) => q.order('id').limit(PAGE).abortSignal(signal), 20_000)
        if (error) throw error
        const rows = (data ?? []) as unknown as CachedProduct[]
        await dbPutMany('products', rows)
        received += rows.length
        report(received)
        for (const r of rows) if (r.updated_at && (!newest || r.updated_at > newest)) newest = r.updated_at
        if (rows.length < PAGE) break
        after = rows[rows.length - 1].id
      }
    }
  }
  await Promise.all(Array.from({ length: PARALLEL }, worker))
  return newest
}

async function doSync(): Promise<boolean> {
  try {
    const meta = (await kvGet<SyncMeta>(META_KEY)) ?? { cursor: null, syncedAt: null }
    let newest = meta.cursor

    if (!meta.cursor) {
      newest = await downloadAll()
    } else {
      // Only what changed since last time. Overlap the cursor slightly so a row changed
      // during the last sync is not missed; each page starts where the last ended (by change
      // time, then id) rather than skipping ahead by offset.
      const since = new Date(new Date(meta.cursor).getTime() - 60_000).toISOString()
      let afterTime: string | null = null
      let afterId: string | null = null
      let received = 0
      for (;;) {
        let q = supabase.from('v_products').select(COLUMNS)
        if (afterTime) q = q.or(`updated_at.gt.${afterTime},and(updated_at.eq.${afterTime},id.gt.${afterId})`)
        else q = q.gte('updated_at', since)
        const { data, error } = await withTimeout(
          (signal) =>
            q.order('updated_at', { ascending: true }).order('id', { ascending: true }).limit(PAGE).abortSignal(signal),
          20_000,
        )
        if (error) throw error
        const rows = (data ?? []) as unknown as CachedProduct[]
        await dbPutMany('products', rows)
        received += rows.length
        report(received)
        for (const r of rows) if (r.updated_at && (!newest || r.updated_at > newest)) newest = r.updated_at
        if (rows.length < PAGE) break
        const last = rows[rows.length - 1]
        afterTime = last.updated_at
        afterId = last.id
      }
    }

    await kvSet(META_KEY, { cursor: newest, syncedAt: new Date().toISOString() } satisfies SyncMeta)
    void refreshConfig().catch(() => undefined)
    reportNetwork(true)
    changed()
    return true
  } catch (err) {
    if (isNetworkError(err)) reportNetwork(false)
    return false
  }
}

/** Re-reads specific codes from the server - used to repair a guess that turned out wrong. */
export async function refreshProducts(codes: string[]): Promise<void> {
  if (codes.length === 0) return
  try {
    const { data, error } = await withTimeout((signal) =>
      supabase.from('v_products').select(COLUMNS).in('qr_code', codes).abortSignal(signal),
    )
    if (error) throw error
    const found = new Set((data ?? []).map((r) => r.qr_code as string))
    await dbPutMany('products', data ?? [])
    // A code the server has never heard of should not linger as a guess.
    for (const code of codes) if (!found.has(code)) await dbDelete('products', code)
    changed()
  } catch {
    /* the next full sync will correct it */
  }
}

/* ----------------------------------------------------------------- lookups */

/** One product straight from the server, also refreshing the phone's copy. */
export async function fetchProductNet(
  code: string,
): Promise<{ ok: true; row: CachedProduct | null } | { ok: false }> {
  try {
    const { data, error } = await withTimeout(
      (signal) =>
        supabase.from('v_products').select(COLUMNS).eq('qr_code', code).abortSignal(signal).maybeSingle(),
      4000,
    )
    if (error) {
      if (isNetworkError(error)) reportNetwork(false)
      return { ok: false }
    }
    reportNetwork(true)
    if (data) await dbPutMany('products', [data])
    else await dbDelete('products', code)
    return { ok: true, row: (data as CachedProduct | null) ?? null }
  } catch {
    reportNetwork(false)
    return { ok: false }
  }
}

/** Which installations to list: the hospital is required, the rest narrow it down. */
export interface PlaceFilter {
  hospitalId: string
  floor?: string
  wardId?: string
  bayId?: string
}

export const LIST_LIMIT = 100

/** What is hanging at a place (a whole hospital, a floor, a ward or a bay), straight from the server. */
export async function fetchInstallationsNet(
  f: PlaceFilter,
): Promise<{ rows: InstallationView[]; total: number } | null> {
  try {
    let q = supabase
      .from('v_installations')
      .select('*', { count: 'exact' })
      .eq('hospital_id', f.hospitalId)
      .is('removed_at', null)
    if (f.bayId) q = q.eq('bay_id', f.bayId)
    else if (f.wardId) q = q.eq('ward_id', f.wardId)
    else if (f.floor) q = q.eq('floor', f.floor)
    const { data, error, count } = await withTimeout(
      (signal) => q.order('due_date', { ascending: true }).limit(LIST_LIMIT).abortSignal(signal),
      6000,
    )
    if (error) {
      if (isNetworkError(error)) reportNetwork(false)
      return null
    }
    reportNetwork(true)
    return { rows: (data ?? []) as InstallationView[], total: count ?? (data ?? []).length }
  } catch {
    reportNetwork(false)
    return null
  }
}

export function getProductLocal(code: string): Promise<CachedProduct | undefined> {
  return dbGet<CachedProduct>('products', code)
}

export async function getByInstallationLocal(installationId: string): Promise<CachedProduct | undefined> {
  return (await dbGetByIndex<CachedProduct>('products', 'installation_id', installationId))[0]
}

function daysBetween(fromIso: string, to = new Date()): number {
  return Math.max(0, Math.floor((to.getTime() - new Date(fromIso).getTime()) / 86_400_000))
}

/** What is hanging at a place, from the phone's own copy. */
export async function installationsLocal(f: PlaceFilter): Promise<{ rows: InstallationView[]; total: number }> {
  const all = f.bayId
    ? await dbGetByIndex<CachedProduct>('products', 'bay_id', f.bayId)
    : await dbGetAll<CachedProduct>('products')
  const hits = all
    .filter(
      (r) =>
        r.installation_id &&
        r.installed_at &&
        r.due_date &&
        r.hospital_id === f.hospitalId &&
        (!f.wardId || r.ward_id === f.wardId) &&
        (!f.floor || f.wardId || r.floor === f.floor),
    )
    .sort((a, b) => (a.due_date! < b.due_date! ? -1 : 1))
  return {
    total: hits.length,
    rows: hits.slice(0, LIST_LIMIT).map((r) => ({
      id: r.installation_id!,
      product_id: r.id,
      qr_code: r.qr_code,
      product_type: r.product_type,
      hospital_id: r.hospital_id ?? '',
      hospital_name: r.hospital_name ?? '',
      ward_id: r.ward_id,
      ward_name: r.ward_name,
      floor: r.floor,
      bay_id: r.bay_id,
      bay_name: r.bay_name,
      installed_at: r.installed_at!,
      installed_by: null,
      installed_by_name: null,
      due_date: r.due_date!,
      removed_at: null,
      removed_by: null,
      removed_by_name: null,
      removal_reason: null,
      removal_notes: null,
      state: 'active' as const,
      days_in_service: daysBetween(r.installed_at!),
      replaces_installation_id: null,
      replaces_qr_code: null,
      replaced_by_qr_code: null,
    })),
  }
}

/* ---------------------------------------------------------- local changes */

export async function applyInstallLocal(args: {
  code: string
  installationId: string
  place: Place
  dueDate: string
  at: string
}) {
  const existing = await getProductLocal(args.code)
  await dbPutMany('products', [
    {
      product_type: 'Curtain',
      product_code: null,
      id: '',
      ...existing,
      qr_code: args.code,
      status: 'in_use',
      installation_id: args.installationId,
      installed_at: args.at,
      due_date: args.dueDate,
      hospital_id: args.place.hospitalId,
      hospital_name: args.place.hospitalName,
      ward_id: args.place.wardId,
      ward_name: args.place.wardName,
      floor: args.place.floor,
      bay_id: args.place.bayId,
      bay_name: args.place.bayName,
      updated_at: existing?.updated_at ?? null,
    } satisfies CachedProduct,
  ])
  changed()
}

export async function applyTakedownLocal(args: { installationIds: string[]; codes: string[] }) {
  const hits = new Map<string, CachedProduct>()
  for (const id of args.installationIds) {
    const p = await getByInstallationLocal(id)
    if (p) hits.set(p.qr_code, p)
  }
  for (const code of args.codes) {
    const p = await getProductLocal(code)
    if (p) hits.set(p.qr_code, p)
  }
  await dbPutMany(
    'products',
    Array.from(hits.values()).map((p) => ({
      ...p,
      status: 'removed',
      installation_id: null,
      installed_at: null,
      due_date: null,
      hospital_id: null,
      hospital_name: null,
      ward_id: null,
      ward_name: null,
      floor: null,
      bay_id: null,
      bay_name: null,
    })),
  )
  changed()
}
