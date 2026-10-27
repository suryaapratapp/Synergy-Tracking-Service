/**
 * The queue of jobs done in the field.
 *
 * Every install and take-down is written here FIRST, on the phone, and only
 * then sent. That one rule is what makes the app safe with bad signal:
 *
 *  - no signal      -> the job waits here and the fitter carries on;
 *  - signal returns -> jobs are sent oldest first, so a take-down always
 *                      lands before the replacement hung in its place;
 *  - a lost reply   -> the job is sent again, and the server (which keys each
 *                      job on its id) applies it only once;
 *  - a refusal      -> the server said no (already installed, retired, ...);
 *                      the job is kept, marked, and shown so nothing vanishes.
 *
 * The time on each job is when the fitter did it, not when it was sent.
 */

import { useSyncExternalStore } from 'react'
import { supabase, friendlyError } from '../supabase'
import { dbDelete, dbGetAll, dbPut } from './db'
import { isNetworkError, networkUsable, orAfter, reportNetwork, withTimeout } from './network'
import { refreshProducts, syncSnapshot } from './snapshot'

export type OpRpc = 'rpc_install_product' | 'rpc_install_replacement' | 'rpc_takedown'

export interface QueuedOp {
  opId: string
  seq: number
  rpc: OpRpc
  /** The RPC arguments, without the actor name, job id and time (added when sent). */
  args: Record<string, unknown>
  /** Who the job belongs to: 'guest' for the shared login, otherwise the user id. */
  owner: string
  actorName?: string
  occurredAt: string
  status: 'pending' | 'failed'
  error?: string
  attempts: number
  /** Product codes touched - used to repair the phone's copy if the job fails. */
  codes: string[]
  /** One line a person can read: "Install RZCIR-… in Ward 4 · Bay 2". */
  label: string
}

export type SendResult =
  | { ok: true; data: unknown }
  | { ok: false; message: string }

/* ------------------------------------------------------------------- state */

let ops: QueuedOp[] = []
let ownerKey: string | null = null
let flushing = false
let loaded: Promise<void> | null = null
let counter = 0

export interface SyncState {
  /** Jobs saved on the phone and not yet sent. */
  pending: number
  /** Jobs the server refused. */
  failed: number
  flushing: boolean
  failedOps: QueuedOp[]
  pendingOps: QueuedOp[]
}

let state: SyncState = { pending: 0, failed: 0, flushing: false, failedOps: [], pendingOps: [] }
const listeners = new Set<() => void>()

function rebuild() {
  const mine = ops.filter((o) => ownerKey === null || o.owner === ownerKey)
  const failedOps = mine.filter((o) => o.status === 'failed')
  const pendingOps = mine.filter((o) => o.status === 'pending')
  state = { pending: pendingOps.length, failed: failedOps.length, flushing, failedOps, pendingOps }
  listeners.forEach((l) => l())
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function useSyncState(): SyncState {
  return useSyncExternalStore(subscribe, () => state, () => state)
}

function ensureLoaded(): Promise<void> {
  if (!loaded) {
    loaded = dbGetAll<QueuedOp>('queue')
      .then((rows) => {
        // Anything found mid-flight on startup is simply pending again.
        ops = rows.sort((a, b) => a.seq - b.seq)
        counter = ops.length
        rebuild()
      })
      .catch(() => undefined)
  }
  return loaded
}
void ensureLoaded()

/* -------------------------------------------------------------------- ids */

export function newId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/* --------------------------------------------------------------- the queue */

export function setQueueOwner(owner: string | null) {
  ownerKey = owner
  rebuild()
  if (owner) void flush()
}

export async function enqueue(input: {
  opId: string
  rpc: OpRpc
  args: Record<string, unknown>
  actorName?: string
  codes: string[]
  label: string
}): Promise<QueuedOp> {
  await ensureLoaded()
  const op: QueuedOp = {
    opId: input.opId,
    seq: Date.now() * 1000 + (counter++ % 1000),
    rpc: input.rpc,
    args: input.args,
    owner: ownerKey ?? 'guest',
    actorName: input.actorName,
    occurredAt: new Date().toISOString(),
    status: 'pending',
    attempts: 0,
    codes: input.codes,
    label: input.label,
  }
  ops.push(op)
  await dbPut('queue', op)
  rebuild()
  return op
}

/** Drops a job that is still waiting. Returns false if it had already gone. */
export async function removePending(opId: string): Promise<boolean> {
  const op = ops.find((o) => o.opId === opId)
  if (!op || op.status !== 'pending') return false
  await removeOp(opId)
  return true
}

async function removeOp(opId: string) {
  ops = ops.filter((o) => o.opId !== opId)
  await dbDelete('queue', opId)
  rebuild()
}

export async function dismissFailed(opId?: string) {
  const victims = ops.filter((o) => o.status === 'failed' && (!opId || o.opId === opId))
  for (const op of victims) await removeOp(op.opId)
}

/** Puts refused jobs back in line to be tried again. */
export async function retryFailed() {
  for (const op of ops.filter((o) => o.status === 'failed')) {
    op.status = 'pending'
    op.error = undefined
    await dbPut('queue', op)
  }
  rebuild()
  void flush()
}

/* ----------------------------------------------------------------- sending */

async function hasSession(): Promise<boolean> {
  // With an expired token and no signal the client can spend half a minute trying to
  // refresh it. Not worth waiting for: the jobs are safe, and the next pass will try again.
  try {
    const { data } = await orAfter(supabase.auth.getSession(), 3000, { data: { session: null }, error: null })
    return !!data.session
  } catch {
    return false
  }
}

type Attempt = SendResult | { retry: true }

async function sendOnce(op: QueuedOp, timeoutMs: number): Promise<Attempt & { status?: number; auth?: boolean }> {
  const body = {
    ...op.args,
    ...(op.actorName ? { p_actor_name: op.actorName } : {}),
    p_op_id: op.opId,
    p_occurred_at: op.occurredAt,
  }
  try {
    const res = await withTimeout(
      (signal) => supabase.rpc(op.rpc, body as never).abortSignal(signal),
      timeoutMs,
    )
    if (!res.error) return { ok: true, data: res.data }

    const err = res.error as { message: string; code?: string }
    const authProblem = res.status === 401 || err.code === 'PGRST301' || err.code === '28000' || /jwt/i.test(err.message)
    if (authProblem) return { retry: true, auth: true }
    if (isNetworkError(err) || (res.status ?? 0) >= 500 || res.status === 0) return { retry: true }
    return { ok: false, message: friendlyError(err) }
  } catch (err) {
    return { retry: true, status: isNetworkError(err) ? 0 : undefined }
  }
}

async function sendOp(op: QueuedOp, timeoutMs: number): Promise<Attempt> {
  let r = await sendOnce(op, timeoutMs)
  if ('retry' in r && r.auth) {
    // The access token may just have expired: refresh it once and go again.
    const { error } = await supabase.auth.refreshSession()
    if (error) return { retry: true }
    r = await sendOnce(op, timeoutMs)
    if ('retry' in r && r.auth) return { retry: true }
  }
  return r
}

/** Results for jobs a screen is waiting on, kept just long enough to be read. */
const watched = new Map<string, SendResult | null>()

export function watch(opId: string) {
  watched.set(opId, null)
}

export function takeResult(opId: string): SendResult | null {
  const r = watched.get(opId) ?? null
  watched.delete(opId)
  return r
}

let chain: Promise<unknown> = Promise.resolve()

/** Sends whatever is waiting, oldest first. Passes run one at a time. */
export function flush(timeoutMs = 12_000): Promise<void> {
  const pass = chain.then(() => flushPass(timeoutMs))
  chain = pass.catch(() => undefined)
  return pass
}

async function flushPass(timeoutMs: number) {
  await ensureLoaded()
  if (!ownerKey) return
  const mine = ops.filter((o) => o.owner === ownerKey && o.status === 'pending').sort((a, b) => a.seq - b.seq)
  if (mine.length === 0) return
  if (!(await hasSession())) return

  flushing = true
  rebuild()

  let sent = 0
  const toRepair: string[] = []
  try {
    for (const op of mine) {
      // A job may have been dropped while an earlier one was in flight.
      if (!ops.includes(op) || op.status !== 'pending') continue

      op.attempts += 1
      const r = await sendOp(op, timeoutMs)

      if ('retry' in r) {
        reportNetwork(false)
        await dbPut('queue', op)
        break // keep the order: nothing after this may go ahead of it
      }

      reportNetwork(true)
      if (r.ok) {
        sent += 1
        await removeOp(op.opId)
        if (watched.has(op.opId)) watched.set(op.opId, r)
      } else {
        op.status = 'failed'
        op.error = r.message
        await dbPut('queue', op)
        toRepair.push(...op.codes)
        if (watched.has(op.opId)) watched.set(op.opId, r)
        rebuild()
      }
    }
  } finally {
    flushing = false
    rebuild()
  }

  if (toRepair.length) await refreshProducts(Array.from(new Set(toRepair)))
  if (sent) void syncSnapshot()
}

/* ---------------------------------------------------------------- triggers */

if (typeof window !== 'undefined') {
  const kick = () => {
    if (state.pending > 0 && networkUsable()) void flush()
  }
  window.addEventListener('online', () => {
    reportNetwork(true)
    void flush()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') kick()
  })
  setInterval(kick, 15_000)
}
