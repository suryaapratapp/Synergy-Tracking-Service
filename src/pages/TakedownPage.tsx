import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase, friendlyError } from '../lib/supabase'
import { useData } from '../context/DataContext'
import { useHidScanner } from '../hooks/useHidScanner'
import ScanField from '../components/ScanField'
import LocationPicker, { EMPTY_LOCATION, type LocationSelection } from '../components/LocationPicker'
import { Card, EmptyState, SectionTitle, Spinner, useToast } from '../components/ui'
import { dueLabel, formatDate, normaliseCode } from '../lib/format'
import { describeBay, installHereUrl, selectionForBay } from '../lib/location'
import { REMOVAL_REASONS, type InstallationView, type ProductView, type RemovalReason } from '../lib/types'

/** Something that has just come down and is waiting for its replacement. */
interface Pending {
  installationId: string
  qrCode: string
  bayId: string
  where: string
}

/** A swap completed this session. */
interface Swap {
  newCode: string
  oldCode: string
  where: string
}

/**
 * Two ways down, because both happen in the field:
 *  - pick the bay and tick off what is being removed (the normal round), or
 *  - scan an individual product that is coming down out of cycle.
 *
 * Whatever comes down joins a replacement queue. The next scan hangs the new
 * product in the same bay, so a swap is scan-old, scan-new with nothing to
 * choose in between.
 */
export default function TakedownPage() {
  const { reload, bay, loading: locationsLoading } = useData()
  const toast = useToast()
  const [params] = useSearchParams()

  const [mode, setMode] = useState<'location' | 'scan'>('scan')
  const [location, setLocation] = useState<LocationSelection>(EMPTY_LOCATION)
  const [rows, setRows] = useState<InstallationView[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [reason, setReason] = useState<RemovalReason>('expired')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)

  const [pending, setPending] = useState<Pending[]>([])
  const [swaps, setSwaps] = useState<Swap[]>([])
  const [hangError, setHangError] = useState<string | null>(null)

  const busyRef = useRef(false)
  const pendingRef = useRef<Pending[]>([])
  pendingRef.current = pending
  const panelRef = useRef<HTMLDivElement>(null)

  // Arriving from an install ("take down in this bay") opens on that bay.
  const presetBay = params.get('bay')
  const presetApplied = useRef(false)
  useEffect(() => {
    if (!presetBay || presetApplied.current || locationsLoading) return
    const sel = selectionForBay(bay(presetBay))
    if (sel) {
      presetApplied.current = true
      setMode('location')
      setLocation(sel)
    }
  }, [presetBay, locationsLoading, bay])

  const loadBay = useCallback(
    async (bayId: string) => {
      if (!bayId) {
        setRows([])
        return
      }
      setLoading(true)
      const { data, error } = await supabase
        .from('v_installations')
        .select('*')
        .eq('bay_id', bayId)
        .is('removed_at', null)
        .order('installed_at', { ascending: true })
      if (error) toast('error', friendlyError(error))
      setRows((data ?? []) as InstallationView[])
      setSelected(new Set())
      setLoading(false)
    },
    [toast],
  )

  useEffect(() => {
    void loadBay(location.bayId)
  }, [location.bayId, loadBay])

  // Bring the replacement prompt into view the moment something comes down.
  const pendingCount = pending.length
  const lastCount = useRef(0)
  useEffect(() => {
    if (pendingCount > lastCount.current) {
      panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    lastCount.current = pendingCount
  }, [pendingCount])

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const refreshAfterChange = (bayId?: string) => {
    void reload()
    if (location.bayId && (!bayId || bayId === location.bayId)) void loadBay(location.bayId)
  }

  /* ---------------------------------------------------------- take down */

  const takeDownSelected = async () => {
    if (selected.size === 0 || busyRef.current) return
    busyRef.current = true
    setBusy(true)

    const chosen = rows.filter((r) => selected.has(r.id))
    const { data, error } = await supabase.rpc('rpc_takedown', {
      p_installation_ids: chosen.map((r) => r.id),
      p_reason: reason,
      p_notes: notes.trim() || null,
    })

    if (error) {
      toast('error', friendlyError(error))
    } else {
      const n = Number(data ?? 0)
      toast('success', `${n} product${n === 1 ? '' : 's'} taken down — ${reasonLabel(reason)}`)
      setNotes('')
      setHangError(null)
      setPending((p) => [
        ...p,
        ...chosen.map((r) => ({
          installationId: r.id,
          qrCode: r.qr_code,
          bayId: r.bay_id,
          where: describeBay(r),
        })),
      ])
      refreshAfterChange()
    }

    busyRef.current = false
    setBusy(false)
  }

  const takeDownCode = async (code: string, found: Pick<ProductView, 'installation_id' | 'bay_id' | 'hospital_name' | 'ward_name' | 'bay_name'> | null) => {
    const { error } = await supabase.rpc('rpc_takedown', {
      p_qr_codes: [code],
      p_reason: reason,
      p_notes: notes.trim() || null,
    })
    if (error) {
      toast('error', friendlyError(error))
      return
    }
    toast('success', `${code} taken down — ${reasonLabel(reason)}`)
    setHangError(null)
    if (found?.installation_id && found.bay_id) {
      setPending((p) => [
        ...p,
        { installationId: found.installation_id!, qrCode: code, bayId: found.bay_id!, where: describeBay(found) },
      ])
    }
    refreshAfterChange(found?.bay_id ?? undefined)
  }

  /* ----------------------------------------------------------- hang up */

  const hang = async (code: string, target: Pending) => {
    const { data, error } = await supabase.rpc('rpc_install_replacement', {
      p_qr_code: code,
      p_replaces_installation_id: target.installationId,
    })
    if (error) {
      const msg = friendlyError(error)
      setHangError(msg)
      toast('error', msg)
      return
    }
    const product = data as unknown as ProductView
    setHangError(null)
    setPending((p) => p.filter((x) => x.installationId !== target.installationId))
    setSwaps((s) => [{ newCode: product.qr_code, oldCode: target.qrCode, where: target.where }, ...s])
    toast('success', `${product.qr_code} hung in ${product.bay_name} — replaces ${target.qrCode}`)
    refreshAfterChange(target.bayId)
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
      try {
        const { data: found } = await supabase
          .from('v_products')
          .select('installation_id, bay_id, hospital_name, ward_name, bay_name')
          .eq('qr_code', code)
          .maybeSingle()

        const next = pendingRef.current[0]
        if (found?.installation_id || !next) {
          await takeDownCode(code, found)
        } else {
          await hang(code, next)
        }
      } finally {
        busyRef.current = false
        setBusy(false)
      }
    },
    // takeDownCode and hang read these; everything else they use is stable.
    [reason, notes, location.bayId],
  )

  // Hardware scans are live in By-scan mode, and whenever a replacement is due.
  const { hardwareSeen } = useHidScanner(handleScan, !busy && (mode === 'scan' || pending.length > 0))

  const next = pending[0]
  const showPanel = pending.length > 0 || swaps.length > 0

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Take down</h1>
          <p className="page-sub">Log products coming out of service — and hang their replacements</p>
        </div>
      </div>

      <div className="mode-switch" role="tablist" aria-label="Take-down method">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'location'}
          className={`mode ${mode === 'location' ? 'is-active' : ''}`}
          onClick={() => setMode('location')}
        >
          <span className="mode-icon" aria-hidden="true">
            <IconPin />
          </span>
          <span className="mode-text">
            <strong>By location</strong>
            <small>Pick a bay, tick what is coming down</small>
          </span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'scan'}
          className={`mode ${mode === 'scan' ? 'is-active' : ''}`}
          onClick={() => setMode('scan')}
        >
          <span className="mode-icon" aria-hidden="true">
            <IconScan />
          </span>
          <span className="mode-text">
            <strong>By scan</strong>
            <small>Scan the old one, then the new one</small>
          </span>
        </button>
      </div>

      {showPanel && (
        <div ref={panelRef} className="next-anchor">
          <Card className="next-card">
            {next ? (
              <>
                <div className="next-head">
                  <span className="next-icon" aria-hidden="true">
                    <IconSwap />
                  </span>
                  <div>
                    <h2>Hang the replacement</h2>
                    <p className="next-sub">
                      {pending.length > 1 ? `1 of ${pending.length} waiting` : 'Same bay, one scan'}
                    </p>
                  </div>
                </div>

                <p className="next-where">
                  <span className="muted">Came down:</span> <strong>{next.qrCode}</strong>
                  <br />
                  <span className="muted">Goes up in:</span> <strong>{next.where}</strong>
                </p>

                <ScanField
                  onSubmit={handleScan}
                  hardwareSeen={hardwareSeen}
                  busy={busy}
                  autoFocus
                  label="Scan the new product"
                />
                <p className="field-hint">
                  Scanning a product that is still hanging takes it down instead, and queues its
                  replacement.
                </p>

                {hangError && (
                  <p className="form-error" role="alert">
                    {hangError}
                  </p>
                )}

                <div className="next-actions">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setPending((p) => p.slice(1))}
                    disabled={busy}
                  >
                    {pending.length > 1 ? 'Skip this one' : 'Not replacing it'}
                  </button>
                  {pending.length > 1 && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setPending([])}
                      disabled={busy}
                    >
                      Skip all
                    </button>
                  )}
                  <Link className="btn btn-ghost btn-sm" to={installHereUrl(next.bayId, next.installationId)}>
                    Open Install for this bay
                  </Link>
                </div>
              </>
            ) : (
              <div className="next-head">
                <span className="next-icon is-done" aria-hidden="true">
                  ✓
                </span>
                <div>
                  <h2>All replacements hung</h2>
                  <p className="next-sub">Scan the next one coming down to carry on.</p>
                </div>
              </div>
            )}

            {swaps.length > 0 && (
              <div className="swap-log">
                <p className="swap-log-title">Swapped this session ({swaps.length})</p>
                <ul>
                  {swaps.map((s) => (
                    <li key={s.newCode}>
                      <span className="swap-new">{s.newCode}</span>
                      <span className="swap-old">replaced {s.oldCode}</span>
                      <span className="swap-where">{s.where}</span>
                    </li>
                  ))}
                </ul>
                {!next && (
                  <button type="button" className="link-button" onClick={() => setSwaps([])}>
                    Clear
                  </button>
                )}
              </div>
            )}
          </Card>
        </div>
      )}

      <Card className="step-card step-1">
        <SectionTitle>
          <span className="step-num">1</span> Reason for removal
        </SectionTitle>
        <div className="reason-group" role="radiogroup" aria-label="Reason for removal">
          {REMOVAL_REASONS.map((r) => (
            <button
              key={r.value}
              type="button"
              role="radio"
              aria-checked={reason === r.value}
              className={`reason ${reason === r.value ? 'is-active' : ''}`}
              onClick={() => setReason(r.value)}
            >
              <span className="reason-label">
                {r.label}
                {r.value === 'expired' && <em> (default)</em>}
              </span>
              <span className="reason-help">{r.help}</span>
            </button>
          ))}
        </div>

        <div className="field">
          <label className="field-label" htmlFor="td-notes">
            Notes <span className="muted">(optional)</span>
          </label>
          <textarea
            id="td-notes"
            className="input"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything the site should know"
          />
        </div>
      </Card>

      {mode === 'location' ? (
        <>
          <Card className="step-card step-2">
            <SectionTitle>
              <span className="step-num">2</span> Which bay?
            </SectionTitle>
            <LocationPicker value={location} onChange={setLocation} disabled={busy} />
          </Card>

          <Card className="step-card step-3">
            <SectionTitle
              action={
                rows.length > 0 ? (
                  <button
                    type="button"
                    className="link-button"
                    onClick={() =>
                      setSelected((prev) =>
                        prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.id)),
                      )
                    }
                  >
                    {selected.size === rows.length ? 'Clear all' : 'Select all'}
                  </button>
                ) : undefined
              }
            >
              <span className="step-num">3</span> What is coming down?
            </SectionTitle>

            {!location.bayId ? (
              <EmptyState title="Choose a bay" hint="Pick the hospital, floor, ward and bay above." />
            ) : loading ? (
              <Spinner />
            ) : rows.length === 0 ? (
              <EmptyState title="Nothing is installed in this bay" />
            ) : (
              <ul className="pick-list">
                {rows.map((r) => {
                  const days = Math.round(
                    (new Date(r.due_date).getTime() - new Date().setHours(0, 0, 0, 0)) / 86400000,
                  )
                  return (
                    <li key={r.id}>
                      <label className={`pick ${selected.has(r.id) ? 'is-selected' : ''}`}>
                        <input
                          type="checkbox"
                          checked={selected.has(r.id)}
                          onChange={() => toggle(r.id)}
                        />
                        <span className="pick-body">
                          <span className="pick-code">{r.qr_code}</span>
                          <span className="pick-meta">
                            Fitted {formatDate(r.installed_at)} · {r.days_in_service} days in service
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
                    ? 'Select what is coming down'
                    : `Take down ${selected.size} ${selected.size === 1 ? 'product' : 'products'} — ${reasonLabel(reason)}`}
              </button>
            </div>
          )}
        </>
      ) : (
        // While a replacement is waiting, the card above owns the one scan field.
        !next && (
          <Card className="step-card step-2">
            <SectionTitle>
              <span className="step-num">2</span> Scan the product coming down
            </SectionTitle>
            <ScanField
              onSubmit={handleScan}
              hardwareSeen={hardwareSeen}
              busy={busy}
              autoFocus
              label="Scan or type the QR / barcode"
            />
            <p className="field-hint">
              Logged straight away with the reason above. You will be asked for its replacement
              next.
            </p>
          </Card>
        )
      )}
    </div>
  )
}

function reasonLabel(r: RemovalReason): string {
  return REMOVAL_REASONS.find((x) => x.value === r)?.label ?? r
}

const strokeProps = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

function IconPin() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" {...strokeProps}>
      <path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.6" />
    </svg>
  )
}

function IconScan() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" {...strokeProps}>
      <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
      <path d="M4 12h16" />
    </svg>
  )
}

function IconSwap() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" {...strokeProps}>
      <path d="M7 4v13M3.5 13.5 7 17l3.5-3.5" />
      <path d="M17 20V7M13.5 10.5 17 7l3.5 3.5" />
    </svg>
  )
}
