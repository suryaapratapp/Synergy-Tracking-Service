/**
 * What the Install and Take-down screens call. Each action is saved on the
 * phone, sent if the network is working, and otherwise left in the queue with
 * the phone's own copy of the data updated - so the screen behaves the same
 * with or without signal, and only the wording ("Saved on this phone") differs.
 */

import { supabase } from '../supabase'
import { readGuestName } from '../guest'
import type { InstallationView, LocationRow, ProductView, RemovalReason } from '../types'
import {
  applyInstallLocal,
  applyTakedownLocal,
  bayInstallationsLocal,
  defaultDueDays,
  fetchBayNet,
  fetchProductNet,
  getByInstallationLocal,
  getProductLocal,
  type CachedProduct,
} from './snapshot'
import { enqueue, flush, newId, removePending, takeResult, watch, type OpRpc, type SyncState } from './queue'
import { networkUsable, withTimeout } from './network'

/* ---------------------------------------------------------------- lookups */

/**
 * A product by its code. The server is asked first when the network is
 * working and nothing is waiting to be sent; otherwise (or if it does not
 * answer quickly) the phone's own copy answers instantly.
 */
export async function lookupProduct(code: string, state: Pick<SyncState, 'pending'>): Promise<CachedProduct | undefined> {
  if (networkUsable() && state.pending === 0) {
    const live = await fetchProductNet(code)
    if (live.ok) return live.row ?? undefined
  }
  return getProductLocal(code)
}

/** `live` is false when the answer came from the phone's own copy. */
export async function bayInstallations(
  bayId: string,
  state: Pick<SyncState, 'pending'>,
): Promise<{ rows: InstallationView[]; live: boolean }> {
  if (networkUsable() && state.pending === 0) {
    const live = await fetchBayNet(bayId)
    if (live) return { rows: live, live: true }
  }
  return { rows: await bayInstallationsLocal(bayId), live: false }
}

export interface InstallationInfo {
  installationId: string
  qrCode: string
  where: string
}

export async function installationInfo(id: string): Promise<InstallationInfo | null> {
  if (networkUsable()) {
    try {
      const { data } = await withTimeout(
        (signal) => supabase.from('v_installations').select('*').eq('id', id).abortSignal(signal).maybeSingle(),
        4000,
      )
      if (data) {
        const r = data as InstallationView
        return { installationId: r.id, qrCode: r.qr_code, where: [r.hospital_name, r.ward_name, r.bay_name].join(' · ') }
      }
    } catch {
      /* fall through to the phone's copy */
    }
  }
  const p = await getByInstallationLocal(id)
  return p
    ? { installationId: id, qrCode: p.qr_code, where: [p.hospital_name, p.ward_name, p.bay_name].filter(Boolean).join(' · ') }
    : null
}

/* ----------------------------------------------------------------- checks */

const STALE = ' (the list on this phone may be out of date)'

function whereIs(p: CachedProduct): string {
  return [p.ward_name, p.bay_name].filter(Boolean).join(' · ') || 'a bay'
}

/** Obvious mistakes, caught from the phone's copy when the server cannot be asked. */
async function checkInstall(code: string): Promise<string | null> {
  if (!/^RZCIR/.test(code)) return `${code} is not a valid product label`
  const p = await getProductLocal(code)
  if (!p) return null // not on this phone's list - the server decides when it can
  if (p.status === 'retired') return `Product ${code} has been retired`
  if (p.installation_id) return `${code} is already installed in ${whereIs(p)} - take it down first${STALE}`
  return null
}

async function checkTakedown(codes: string[]): Promise<string | null> {
  for (const code of codes) {
    if (!/^RZCIR/.test(code)) return `${code} is not a valid product label`
    const p = await getProductLocal(code)
    if (p && !p.installation_id) return `${code} is not currently installed${STALE}`
  }
  return null
}

/* ----------------------------------------------------------------- submit */

type Submitted<T> = { queued: false; data: T } | { queued: true }

async function submit<T>(job: {
  opId: string
  rpc: OpRpc
  args: Record<string, unknown>
  codes: string[]
  label: string
  check: () => Promise<string | null>
  applyLocal: () => Promise<void>
}): Promise<Submitted<T>> {
  const actorName = readGuestName() || undefined
  await enqueue({ opId: job.opId, rpc: job.rpc, args: job.args, actorName, codes: job.codes, label: job.label })
  watch(job.opId)

  // Try straight away. A quick answer (yes or no) is the normal case.
  if (networkUsable()) await flush(6000)

  const result = takeResult(job.opId)
  if (result?.ok) {
    await job.applyLocal()
    return { queued: false, data: result.data as T }
  }
  if (result && !result.ok) {
    // The server refused it. It is shown to the person now, so drop it from the queue.
    await removePending(job.opId)
    throw new Error(result.message)
  }

  // Still waiting: no signal. Catch obvious mistakes from the phone's copy.
  const problem = await job.check()
  if (problem && (await removePending(job.opId))) throw new Error(problem)

  await job.applyLocal()
  return { queued: true }
}

/* ------------------------------------------------------------------ jobs */

export interface InstalledItem {
  key: string
  /** Server product id - empty for something saved on the phone and not yet sent. */
  id: string
  qr_code: string
  ward_name: string | null
  bay_name: string | null
  due_date: string | null
  queued: boolean
}

function dueFrom(atIso: string, days: number): string {
  const d = new Date(atIso)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

async function installJob(args: {
  rpc: 'rpc_install_product' | 'rpc_install_replacement'
  rpcArgs: Record<string, unknown>
  code: string
  bay: LocationRow
  dueDays: number | null
  label: string
}): Promise<InstalledItem> {
  const opId = newId()
  const at = new Date().toISOString()
  const days = args.dueDays ?? (await defaultDueDays())
  const dueDate = dueFrom(at, days)

  const out = await submit<ProductView>({
    opId,
    rpc: args.rpc,
    args: args.rpcArgs,
    codes: [args.code],
    label: args.label,
    check: () => checkInstall(args.code),
    applyLocal: () =>
      applyInstallLocal({ code: args.code, installationId: opId, bay: args.bay, dueDate, at }),
  })

  if (out.queued) {
    return {
      key: opId,
      id: '',
      qr_code: args.code,
      ward_name: args.bay.ward_name,
      bay_name: args.bay.bay_name,
      due_date: dueDate,
      queued: true,
    }
  }
  const p = out.data
  return {
    key: p.installation_id ?? opId,
    id: p.id,
    qr_code: p.qr_code,
    ward_name: p.ward_name,
    bay_name: p.bay_name,
    due_date: p.due_date,
    queued: false,
  }
}

export function installProduct(args: {
  code: string
  bay: LocationRow
  dueDays: number | null
}): Promise<InstalledItem> {
  return installJob({
    rpc: 'rpc_install_product',
    rpcArgs: { p_qr_code: args.code, p_bay_id: args.bay.bay_id, p_due_days: args.dueDays },
    code: args.code,
    bay: args.bay,
    dueDays: args.dueDays,
    label: `Install ${args.code} in ${args.bay.ward_name} · ${args.bay.bay_name}`,
  })
}

export function hangReplacement(args: {
  code: string
  replacesInstallationId: string
  replacesCode: string
  bay: LocationRow
  dueDays: number | null
}): Promise<InstalledItem> {
  return installJob({
    rpc: 'rpc_install_replacement',
    rpcArgs: {
      p_qr_code: args.code,
      p_replaces_installation_id: args.replacesInstallationId,
      p_due_days: args.dueDays,
    },
    code: args.code,
    bay: args.bay,
    dueDays: args.dueDays,
    label: `Hang ${args.code} in place of ${args.replacesCode}`,
  })
}

export async function takeDown(args: {
  installationIds?: string[]
  codes?: string[]
  /** The codes behind `installationIds`, for the phone's copy; not sent to the server. */
  idCodes?: string[]
  reason: RemovalReason
  notes: string | null
}): Promise<{ queued: boolean; count: number }> {
  const codes = args.codes ?? []
  const ids = args.installationIds ?? []
  const touched = [...codes, ...(args.idCodes ?? [])]
  const what = touched.length ? touched.join(', ') : `${ids.length} product${ids.length === 1 ? '' : 's'}`

  const out = await submit<number>({
    opId: newId(),
    rpc: 'rpc_takedown',
    args: {
      ...(ids.length ? { p_installation_ids: ids } : {}),
      ...(codes.length ? { p_qr_codes: codes } : {}),
      p_reason: args.reason,
      p_notes: args.notes,
    },
    codes: touched,
    label: `Take down ${what}`,
    check: () => checkTakedown(codes),
    applyLocal: () => applyTakedownLocal({ installationIds: ids, codes: touched }),
  })
  return out.queued
    ? { queued: true, count: Math.max(codes.length, ids.length) }
    : { queued: false, count: Number(out.data ?? 0) || Math.max(codes.length, ids.length) }
}
