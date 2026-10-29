import { useCallback, useEffect, useRef, useState } from 'react'
import { useData } from '../context/DataContext'
import { useHidScanner } from '../hooks/useHidScanner'
import ScanField from '../components/ScanField'
import LocationPicker, { EMPTY_LOCATION, type LocationSelection } from '../components/LocationPicker'
import { Card, EmptyState, Field, Spinner, useToast } from '../components/ui'
import { dueLabel, formatDate, normaliseCode } from '../lib/format'
import { describePlace, placeOf, shortPlace, type Place } from '../lib/location'
import { hangReplacement, installationsAt, lookupProduct, takeDown } from '../lib/offline/actions'
import { useSyncState } from '../lib/offline/queue'
import type { CachedProduct } from '../lib/offline/snapshot'
import { LIST_LIMIT } from '../lib/offline/snapshot'
import { REMOVAL_REASONS, type InstallationView, type RemovalReason } from '../lib/types'

type Mode = 'scan' | 'location'

/** Something that has come down and is waiting for its replacement. */
interface Pending {
  installationId: string
  qrCode: string
  place: Place
}

/** A swap completed this session. */
interface Swap {
  newCode: string
  oldCode: string
  where: string
}

const REASON_LABELS: Record<RemovalReason, string> = { expired: 'Expired', soiled: 'Soiled', damage: 'Damaged' }

/**
 * Take down - and put the new one up, in one flow.
 *
 * Most visits are a swap: the old curtain comes down and a new one goes in its
 * place. So taking something down always asks for its replacement straight
 * away, and the new curtain goes exactly where the old one was - nothing about
 * the location is asked again.
 *
 *  - By scan (the default): scan the old curtain, then the new one.
 *  - By location: choose where, tick what is coming down, then scan each new one.
 */
export default function TakedownPage() {
  const { reload, placeFor } = useData()
  const toast = useToast()
  const sync = useSyncState()
  const syncRef = useRef(sync)
  syncRef.current = sync

  const [mode, setMode] = useState<Mode>('scan')
  const [reason, setReason] = useState<RemovalReason>('expired')
  const [notes, setNotes] = useState('')
  const [showNote, setShowNote] = useState(false)

  const [location, setLocation] = useState<LocationSelection>(EMPTY_LOCATION)
  const [rows, setRows] = useState<InstallationView[]>([])
  const [total, setTotal] = useState(0)
  const [fromPhone, setFromPhone] = useState(false)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const [pending, setPending] = useState<Pending[]>([])
  const [swaps, setSwaps] = useState<Swap[]>([])
  const [scanError, setScanError] = useState<string | null>(null)

  const busyRef = useRef(false)
  const pendingRef = useRef<Pending[]>([])
  pendingRef.current = pending

  const loadList = useCallback(async (sel: LocationSelection) => {
    if (!sel.hospitalId) {
      setRows([])
      setTotal(0)
      return
    }
    setLoading(true)
    const res = await installationsAt(
      {
        hospitalId: sel.hospitalId,
        floor: sel.floor || undefined,
        wardId: sel.wardId || undefined,
        bayId: sel.bayId || undefined,
      },
      syncRef.current,
    )
    setRows(res.rows)
    setTotal(res.total)
    setFromPhone(!res.live)
    setSelected(new Set())
    setLoading(false)
  }, [])

  useEffect(() => {
    if (mode === 'location') void loadList(location)
  }, [mode, location, loadList])

  const refreshAfterChange = () => {
    void reload()
    if (mode === 'location') void loadList(location)
  }

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const noteOrNull = () => notes.trim() || null

  /* ------------------------------------------------------------ take down */

  const takeDownSelected = async () => {
    if (selected.size === 0 || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setScanError(null)

    const chosen = rows.filter((r) => selected.has(r.id))
    try {
      const res = await takeDown({
        installationIds: chosen.map((r) => r.id),
        idCodes: chosen.map((r) => r.qr_code),
        reason,
        notes: noteOrNull(),
      })
      toast(
        res.queued ? 'info' : 'success',
        res.queued
          ? `${res.count} saved as taken down`
          : `${res.count} taken down`,
      )
      setNotes('')
      setPending((p) => [
        ...p,
        ...chosen.map((r) => ({ installationId: r.id, qrCode: r.qr_code, place: placeOf(r) })),
      ])
      refreshAfterChange()
    } catch (err) {
      // Location mode has no scan field to show it under, so this one is a pop-up.
      toast('error', (err as Error).message)
    }

    busyRef.current = false
    setBusy(false)
  }

  const takeDownCode = async (code: string, found: CachedProduct | undefined) => {
    try {
      const res = await takeDown({ codes: [code], reason, notes: noteOrNull() })
      toast(res.queued ? 'info' : 'success', res.queued ? `${code} saved as taken down` : `${code} taken down`)
    } catch (err) {
      setScanError((err as Error).message)
      return
    }
    setScanError(null)
    if (found?.installation_id && found.hospital_id) {
      setPending((p) => [
        ...p,
        {
          installationId: found.installation_id!,
          qrCode: code,
          place: placeOf({
            hospital_id: found.hospital_id!,
            hospital_name: found.hospital_name ?? '',
            ward_id: found.ward_id,
            ward_name: found.ward_name,
            floor: found.floor,
            bay_id: found.bay_id,
            bay_name: found.bay_name,
          }),
        },
      ])
    }
    refreshAfterChange()
  }

  /* ------------------------------------------------------------- hang new */

  const hang = async (code: string, target: Pending) => {
    try {
      const item = await hangReplacement({
        code,
        replacesInstallationId: target.installationId,
        replacesCode: target.qrCode,
        place: target.place,
        dueDays: null,
      })
      setScanError(null)
      setPending((p) => p.filter((x) => x.installationId !== target.installationId))
      setSwaps((s) => [{ newCode: item.qr_code, oldCode: target.qrCode, where: shortPlace(target.place) }, ...s])
      toast(item.queued ? 'info' : 'success', item.queued ? `${item.qr_code} saved on this phone` : `${item.qr_code} fitted`)
      refreshAfterChange()
    } catch (err) {
      setScanError((err as Error).message)
    }
  }

  /**
   * One scan, two meanings, decided by the product itself: if it is still
   * hanging it is coming down; if it is not, and something is waiting for a
   * replacement, it is going up.
   */
  const handleScan = useCallback(
    async (raw: string) => {
      const code = normaliseCode(raw)
      if (!code || busyRef.current) return
      busyRef.current = true
      setBusy(true)
      setScanError(null)
      try {
        const found = await lookupProduct(code, syncRef.current)
        const next = pendingRef.current[0]
        if (found?.installation_id || !next) await takeDownCode(code, found)
        else await hang(code, next)
      } finally {
        busyRef.current = false
        setBusy(false)
      }
    },
    // takeDownCode and hang read these; everything else they use is stable.
    [reason, notes, mode, location, placeFor],
  )

  const { hardwareSeen } = useHidScanner(handleScan, !busy && (mode === 'scan' || pending.length > 0))
  void hardwareSeen

  const next = pending[0]
  const place = placeFor(location)

  return (
    <div className="page page-tight">
      <div className="page-head">
        <div>
          <h1>Take down</h1>
          <p className="page-sub">Remove the old curtain, then scan the new one</p>
        </div>
      </div>

      <Card className="tight-card">
        <div className="pair">
          <Field label="Method" htmlFor="td-mode">
            <select
              id="td-mode"
              className="input"
              value={mode}
              onChange={(e) => {
                setMode(e.target.value as Mode)
                setScanError(null)
              }}
            >
              <option value="scan">By scan</option>
              <option value="location">By location</option>
            </select>
          </Field>
          <Field label="Reason" htmlFor="td-reason">
            <select
              id="td-reason"
              className="input"
              value={reason}
              onChange={(e) => setReason(e.target.value as RemovalReason)}
            >
              {REMOVAL_REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {REASON_LABELS[r.value]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {showNote ? (
          <textarea
            id="td-notes"
            className="input"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Note (optional)"
            aria-label="Note"
          />
        ) : (
          <button type="button" className="link-button" onClick={() => setShowNote(true)}>
            + Add a note
          </button>
        )}
      </Card>

      {next ? (
        <Card className="swap-card">
          <div className="swap-head">
            <span className="swap-tag">Replace</span>
            <strong className="swap-code">{next.qrCode}</strong>
            {pending.length > 1 && <span className="swap-count">1 of {pending.length}</span>}
          </div>
          <p className="swap-where">{describePlace(next.place)}</p>
          <ScanField
            onSubmit={handleScan}
            busy={busy}
            autoFocus
            label="Scan the new curtain"
            error={scanError}
          />
          <div className="swap-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setPending((p) => p.slice(1))}
              disabled={busy}
            >
              No replacement
            </button>
            {pending.length > 1 && (
              <button type="button" className="btn btn-ghost" onClick={() => setPending([])} disabled={busy}>
                Skip all
              </button>
            )}
          </div>
        </Card>
      ) : (
        mode === 'scan' && (
          <Card className="tight-card">
            <ScanField
              onSubmit={handleScan}
              busy={busy}
              autoFocus
              label="Scan the old curtain"
              error={scanError}
            />
          </Card>
        )
      )}

      {mode === 'location' && (
        <>
          <Card className="tight-card">
            <h2 className="mini-title">Where?</h2>
            <LocationPicker value={location} onChange={setLocation} disabled={busy} />
          </Card>

          <Card className="tight-card">
            <div className="mini-head">
              <h2 className="mini-title">
                What is coming down?
                {place && rows.length > 0 && (
                  <span className="mini-count">
                    {' '}
                    ({total > rows.length ? `${rows.length} of ${total}` : total})
                  </span>
                )}
              </h2>
              {rows.length > 0 && (
                <button
                  type="button"
                  className="link-button"
                  onClick={() =>
                    setSelected((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.id))))
                  }
                >
                  {selected.size === rows.length ? 'Clear' : 'Select all'}
                </button>
              )}
            </div>

            {!location.hospitalId ? (
              <EmptyState title="Choose a hospital" />
            ) : loading ? (
              <Spinner />
            ) : rows.length === 0 ? (
              <EmptyState
                title="Nothing installed here"
                hint={fromPhone ? 'From the list saved on this phone.' : undefined}
              />
            ) : (
              <>
                <ul className="pick-list">
                  {rows.map((r) => {
                    const days = Math.round(
                      (new Date(r.due_date).getTime() - new Date().setHours(0, 0, 0, 0)) / 86400000,
                    )
                    return (
                      <li key={r.id}>
                        <label className={`pick ${selected.has(r.id) ? 'is-selected' : ''}`}>
                          <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                          <span className="pick-body">
                            <span className="pick-code">{r.qr_code}</span>
                            <span className="pick-meta">
                              {shortPlace(placeOf(r))} · fitted {formatDate(r.installed_at)}
                            </span>
                          </span>
                          <span className={`badge badge-due-${days < 0 ? 'danger' : days <= 3 ? 'warn' : 'ok'}`}>
                            {dueLabel(days)}
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
                {total > LIST_LIMIT && (
                  <p className="muted tight-note">
                    Showing the {LIST_LIMIT} most overdue. Choose a floor, ward or bay to narrow it down.
                  </p>
                )}
              </>
            )}
          </Card>

          {rows.length > 0 && (
            <div className="sticky-action">
              <button
                type="button"
                className="btn btn-primary btn-lg btn-block"
                disabled={selected.size === 0 || busy}
                onClick={() => void takeDownSelected()}
              >
                {busy
                  ? 'Working…'
                  : selected.size === 0
                    ? 'Tick what is coming down'
                    : `Take down ${selected.size} · ${REASON_LABELS[reason]}`}
              </button>
            </div>
          )}
        </>
      )}

      {swaps.length > 0 && (
        <Card className="tight-card">
          <div className="mini-head">
            <h2 className="mini-title">Swapped ({swaps.length})</h2>
            {!next && (
              <button type="button" className="link-button" onClick={() => setSwaps([])}>
                Clear
              </button>
            )}
          </div>
          <ul className="swap-log-list">
            {swaps.map((s) => (
              <li key={s.newCode}>
                <span className="swap-new">{s.newCode}</span>
                <span className="swap-old">replaced {s.oldCode}</span>
                <span className="swap-where">{s.where}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
