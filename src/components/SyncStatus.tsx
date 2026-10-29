import { useEffect, useRef, useState } from 'react'
import { useNetworkUsable } from '../lib/offline/network'
import { dismissFailed, flush, retryFailed, useSyncState } from '../lib/offline/queue'
import { onSnapshotChange, snapshotInfo, syncSnapshot } from '../lib/offline/snapshot'
import { relativeTime } from '../lib/format'
import { useAuth } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import { Sheet } from './ui'

function useSnapshotInfo() {
  const [info, setInfo] = useState<{ syncedAt: string | null; count: number }>({ syncedAt: null, count: 0 })
  useEffect(() => {
    let live = true
    const load = () => void snapshotInfo().then((i) => live && setInfo(i))
    load()
    const stop = onSnapshotChange(load)
    return () => {
      live = false
      stop()
    }
  }, [])
  return info
}

/**
 * The strip under the header. It says plainly what the app is doing about the
 * signal: working offline, sending saved jobs, or holding something the
 * server refused. Tap it for the detail.
 */
export default function SyncStatus() {
  const sync = useSyncState()
  const usable = useNetworkUsable()
  const { offlineSession } = useAuth()
  const info = useSnapshotInfo()
  const [open, setOpen] = useState(false)

  const offline = !usable || offlineSession
  const waiting = sync.pending

  return (
    <>
      {offline && (
        <button type="button" className="sync-bar sync-offline" onClick={() => setOpen(true)}>
          <strong>Offline.</strong> Jobs are saved on this phone and sent when you have signal
          {waiting > 0 ? ` · ${waiting} waiting` : ''}
        </button>
      )}
      {!offline && waiting > 0 && (
        <button type="button" className="sync-bar sync-sending" onClick={() => setOpen(true)}>
          {sync.flushing ? 'Sending' : 'Waiting to send'} {waiting} saved job{waiting === 1 ? '' : 's'}…
        </button>
      )}
      {sync.failed > 0 && (
        <button type="button" className="sync-bar sync-failed" onClick={() => setOpen(true)}>
          <strong>{sync.failed} job{sync.failed === 1 ? '' : 's'} could not be saved.</strong> Tap to review
        </button>
      )}

      <Sheet open={open} title="Saved on this phone" onClose={() => setOpen(false)}>
        <p className="sheet-lead">
          {offline
            ? 'There is no signal right now. Everything you do is kept on this phone and sent automatically, in order, as soon as you are connected.'
            : 'You are connected. Saved jobs are sent automatically.'}
        </p>

        {sync.failedOps.length > 0 && (
          <div className="sync-group">
            <h3>Not saved — the server said no</h3>
            <ul className="sync-list">
              {sync.failedOps.map((op) => (
                <li key={op.opId} className="sync-item sync-item-failed">
                  <span className="sync-item-label">{op.label}</span>
                  <span className="sync-item-error">{op.error}</span>
                  <button type="button" className="link-button" onClick={() => void dismissFailed(op.opId)}>
                    Dismiss
                  </button>
                </li>
              ))}
            </ul>
            <div className="sync-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void retryFailed()}>
                Try again
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void dismissFailed()}>
                Dismiss all
              </button>
            </div>
          </div>
        )}

        {sync.pendingOps.length > 0 && (
          <div className="sync-group">
            <h3>Waiting to be sent ({sync.pendingOps.length})</h3>
            <ul className="sync-list">
              {sync.pendingOps.map((op) => (
                <li key={op.opId} className="sync-item">
                  <span className="sync-item-label">{op.label}</span>
                  <span className="sync-item-meta">{relativeTime(op.occurredAt)}</span>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="btn btn-primary btn-block"
              disabled={offline || sync.flushing}
              onClick={() => void flush()}
            >
              {sync.flushing ? 'Sending…' : 'Send now'}
            </button>
          </div>
        )}

        {sync.pendingOps.length === 0 && sync.failedOps.length === 0 && (
          <p className="muted">Nothing is waiting to be sent.</p>
        )}

        <p className="muted sync-foot">
          Product list on this phone: {info.count.toLocaleString()} products
          {info.syncedAt ? `, updated ${relativeTime(info.syncedAt)}` : ', not downloaded yet'}.
        </p>
      </Sheet>
    </>
  )
}

const FRESH_MS = 12 * 60 * 60 * 1000

/**
 * The one control on the home screen for staying ready for a signal outage:
 * it refreshes the site and product lists kept on the phone. The dot says
 * whether they are recent (green) or due a refresh (amber) - no counts, no
 * explanation.
 */
export function UpdateButton() {
  const usable = useNetworkUsable()
  const info = useSnapshotInfo()
  const { reload } = useData()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<'ok' | 'fail' | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [, tick] = useState(0)

  // The dot turns amber on its own as the data ages.
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 60_000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => () => clearTimeout(timer.current), [])

  const fresh = !!info.syncedAt && Date.now() - new Date(info.syncedAt).getTime() < FRESH_MS

  const update = async () => {
    setBusy(true)
    setResult(null)
    clearTimeout(timer.current)
    await reload()
    const ok = await syncSnapshot()
    setBusy(false)
    setResult(ok ? 'ok' : 'fail')
    // Say what happened, then get out of the way.
    timer.current = setTimeout(() => setResult(null), ok ? 8000 : 10_000)
  }

  return (
    <div className="update-wrap">
      <button
        type="button"
        className={`update-btn ${result === 'ok' ? 'is-done' : fresh ? 'is-fresh' : 'is-stale'}`}
        onClick={() => void update()}
        disabled={busy || !usable}
      >
        <span className={`update-dot ${busy ? 'is-busy' : ''}`} aria-hidden="true" />
        {busy ? 'Updating…' : result === 'ok' ? 'Updated' : 'Update'}
      </button>

      {result === 'ok' && (
        <p className="update-msg update-msg-ok" role="status">
          <span className="update-tick" aria-hidden="true">
            ✓
          </span>
          Updated just now. Ready to work offline.
        </p>
      )}
      {result === 'fail' && (
        <p className="update-msg update-msg-bad" role="alert">
          Could not update. Check your signal and try again.
        </p>
      )}
    </div>
  )
}
