import { useCallback, useEffect, useState } from 'react'
import { supabase, friendlyError } from '../lib/supabase'
import { useData } from '../context/DataContext'
import { useHidScanner } from '../hooks/useHidScanner'
import ScanField from '../components/ScanField'
import LocationPicker, { EMPTY_LOCATION, type LocationSelection } from '../components/LocationPicker'
import { Card, EmptyState, SectionTitle, Spinner, useToast } from '../components/ui'
import { dueLabel, formatDate } from '../lib/format'
import { REMOVAL_REASONS, type InstallationView, type RemovalReason } from '../lib/types'

/**
 * Two ways down, because both happen in the field:
 *  - pick the bay and tick off what is being removed (the normal round), or
 *  - scan an individual product that is coming down out of cycle.
 */
export default function TakedownPage() {
  const { reload } = useData()
  const toast = useToast()

  const [mode, setMode] = useState<'location' | 'scan'>('scan')
  const [location, setLocation] = useState<LocationSelection>(EMPTY_LOCATION)
  const [rows, setRows] = useState<InstallationView[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [reason, setReason] = useState<RemovalReason>('expired')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)

  const loadBay = useCallback(async (bayId: string) => {
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
  }, [toast])

  useEffect(() => {
    void loadBay(location.bayId)
  }, [location.bayId, loadBay])

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const takeDownSelected = async () => {
    if (selected.size === 0 || busy) return
    setBusy(true)
    const { data, error } = await supabase.rpc('rpc_takedown', {
      p_installation_ids: Array.from(selected),
      p_reason: reason,
      p_notes: notes.trim() || null,
    })
    if (error) {
      toast('error', friendlyError(error))
    } else {
      const n = Number(data ?? 0)
      toast('success', `${n} product${n === 1 ? '' : 's'} taken down — ${reasonLabel(reason)}`)
      setNotes('')
      void loadBay(location.bayId)
      void reload()
    }
    setBusy(false)
  }

  const takeDownByCode = useCallback(
    async (code: string) => {
      if (busy) return
      setBusy(true)
      const { error } = await supabase.rpc('rpc_takedown', {
        p_qr_codes: [code],
        p_reason: reason,
        p_notes: notes.trim() || null,
      })
      if (error) toast('error', friendlyError(error))
      else {
        toast('success', `${code} taken down — ${reasonLabel(reason)}`)
        void reload()
        if (location.bayId) void loadBay(location.bayId)
      }
      setBusy(false)
    },
    [busy, reason, notes, toast, reload, location.bayId, loadBay],
  )

  const { hardwareSeen } = useHidScanner(takeDownByCode, mode === 'scan' && !busy)

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Take down</h1>
          <p className="page-sub">Log products coming out of service</p>
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
            <small>Scan one product coming down</small>
          </span>
        </button>
      </div>

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
        <Card className="step-card step-2">
          <SectionTitle>
            <span className="step-num">2</span> Scan the product coming down
          </SectionTitle>
          <ScanField
            onSubmit={takeDownByCode}
            hardwareSeen={hardwareSeen}
            busy={busy}
            autoFocus
            label="Scan or type the QR / barcode"
          />
          <p className="field-hint">
            Each scan is logged straight away with the reason selected above.
          </p>
        </Card>
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
