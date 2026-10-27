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

import { supabase, fetchAllRows } from '../supabase'
import type { InstallationView, LocationRow, ProductView } from '../types'
import { dbCount, dbDelete, dbGet, dbGetByIndex, dbPutMany, kvGet, kvSet } from './db'
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

/**
 * Brings the phone's product list up to date. Safe to call often: it does
 * nothing without a working connection and never runs twice at once.
 */
export function syncSnapshot(): Promise<boolean> {
  if (!networkUsable()) return Promise.resolve(false)
  if (!syncing) {
    syncing = doSync().finally(() => {
      syncing = null
    })
  }
  return syncing
}

async function doSync(): Promise<boolean> {
  try {
    const meta = (await kvGet<SyncMeta>(META_KEY)) ?? { cursor: null, syncedAt: null }
    // Overlap the cursor slightly so a row changed during the last sync is not missed.
    const since = meta.cursor ? new Date(new Date(meta.cursor).getTime() - 60_000).toISOString() : null

    const { rows, error } = await fetchAllRows<CachedProduct>(
      (from, to) => {
        let q = supabase.from('v_products').select(COLUMNS)
        if (since) q = q.gte('updated_at', since)
        return q.order('updated_at', { ascending: true }).order('id', { ascending: true }).range(from, to)
      },
      200_000,
    )
    if (error) throw error

    await dbPutMany('products', rows)
    const newest = rows.reduce<string | null>(
      (max, r) => (r.updated_at && (!max || r.updated_at > max) ? r.updated_at : max),
      meta.cursor,
    )
    await kvSet(META_KEY, {
      cursor: newest,
      syncedAt: new Date().toISOString(),
    } satisfies SyncMeta)
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

/** What is hanging in a bay, straight from the server. */
export async function fetchBayNet(bayId: string): Promise<InstallationView[] | null> {
  try {
    const { data, error } = await withTimeout(
      (signal) =>
        supabase
          .from('v_installations')
          .select('*')
          .eq('bay_id', bayId)
          .is('removed_at', null)
          .order('installed_at', { ascending: true })
          .abortSignal(signal),
      5000,
    )
    if (error) {
      if (isNetworkError(error)) reportNetwork(false)
      return null
    }
    reportNetwork(true)
    return (data ?? []) as InstallationView[]
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

/** What is hanging in a bay, from the phone's copy. */
export async function bayInstallationsLocal(bayId: string): Promise<InstallationView[]> {
  const rows = await dbGetByIndex<CachedProduct>('products', 'bay_id', bayId)
  return rows
    .filter((r) => r.installation_id && r.installed_at && r.due_date)
    .sort((a, b) => (a.installed_at! < b.installed_at! ? -1 : 1))
    .map((r) => ({
      id: r.installation_id!,
      product_id: r.id,
      qr_code: r.qr_code,
      product_type: r.product_type,
      hospital_id: r.hospital_id ?? '',
      hospital_name: r.hospital_name ?? '',
      ward_id: r.ward_id ?? '',
      ward_name: r.ward_name ?? '',
      floor: r.floor ?? '',
      bay_id: r.bay_id ?? bayId,
      bay_name: r.bay_name ?? '',
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
    }))
}

/* ---------------------------------------------------------- local changes */

export async function applyInstallLocal(args: {
  code: string
  installationId: string
  bay: LocationRow
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
      hospital_id: args.bay.hospital_id,
      hospital_name: args.bay.hospital_name,
      ward_id: args.bay.ward_id,
      ward_name: args.bay.ward_name,
      floor: args.bay.floor,
      bay_id: args.bay.bay_id,
      bay_name: args.bay.bay_name,
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
