import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase, friendlyError } from '../lib/supabase'
import { useData } from '../context/DataContext'
import { useHidScanner } from '../hooks/useHidScanner'
import ScanField from '../components/ScanField'
import LocationPicker, { EMPTY_LOCATION, type LocationSelection } from '../components/LocationPicker'
import { Card, EmptyState, SectionTitle, useToast } from '../components/ui'
import { formatDate } from '../lib/format'
import { describeBay, selectionForBay, takeDownHereUrl } from '../lib/location'
import type { InstallationView, ProductView } from '../lib/types'

const LOCATION_KEY = 'synergy.lastInstallLocation'

/** The take-down this install is standing in for, when opened as a replacement. */
interface Replacing {
  installationId: string
  qrCode: string
  where: string
}

/** What is hanging in the current bay right now. */
interface BayStatus {
  bayId: string
  inPlace: number
  overdue: number
}

/**
 * Location first, then scan repeatedly. A fitter working a bay sets the
 * location once and then just pulls the trigger for each curtain.
 *
 * After each install the screen offers to take something down in the same
 * bay, so a swap started from this side is one tap away too.
 */
export default function InstallPage() {
  const { bay, reload, loading: locationsLoading } = useData()
  const toast = useToast()
  const [params, setParams] = useSearchParams()

  const [location, setLocation] = useState<LocationSelection>(() => {
    try {
      const saved = localStorage.getItem(LOCATION_KEY)
      return saved ? (JSON.parse(saved) as LocationSelection) : EMPTY_LOCATION
    } catch {
      return EMPTY_LOCATION
    }
  })
  const [dueDays, setDueDays] = useState<number | ''>('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<ProductView[]>([])
  const [lastError, setLastError] = useState<string | null>(null)
  const [replacing, setReplacing] = useState<Replacing | null>(null)
  const [bayStatus, setBayStatus] = useState<BayStatus | null>(null)
  const busyRef = useRef(false)
  const nextRef = useRef<HTMLDivElement>(null)

  // Links from Take down arrive with ?bay= and, for a swap, ?replaces=.
  const presetBay = params.get('bay')
  const replacesId = params.get('replaces')
  const presetApplied = useRef(false)

  useEffect(() => {
    if (!presetBay || presetApplied.current || locationsLoading) return
    const sel = selectionForBay(bay(presetBay))
    if (sel) {
      presetApplied.current = true
      setLocation(sel)
    }
  }, [presetBay, locationsLoading, bay])

  useEffect(() => {
    if (!replacesId) {
      setReplacing(null)
      return
    }
    let cancelled = false
    void supabase
      .from('v_installations')
      .select('*')
      .eq('id', replacesId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data) return
        const row = data as InstallationView
        setReplacing({ installationId: row.id, qrCode: row.qr_code, where: describeBay(row) })
      })
    return () => {
      cancelled = true
    }
  }, [replacesId])

  useEffect(() => {
    if (location.bayId) localStorage.setItem(LOCATION_KEY, JSON.stringify(location))
  }, [location])

  const selectedBay = location.bayId ? bay(location.bayId) : undefined

  const loadBayStatus = useCallback(async (bayId: string) => {
    const today = new Date().toISOString().slice(0, 10)
    const { data } = await supabase
      .from('v_installations')
      .select('due_date')
      .eq('bay_id', bayId)
      .is('removed_at', null)
    const list = (data ?? []) as { due_date: string }[]
    setBayStatus({ bayId, inPlace: list.length, overdue: list.filter((r) => r.due_date < today).length })
  }, [])

  const stopReplacing = useCallback(() => {
    setReplacing(null)
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('replaces')
        return next
      },
      { replace: true },
    )
  }, [setParams])

  const install = useCallback(
    async (code: string) => {
      if (busyRef.current) return
      if (!location.bayId) {
        setLastError('Choose the hospital, floor, ward and bay first.')
        toast('error', 'Choose a location first')
        return
      }

      busyRef.current = true
      setBusy(true)
      setLastError(null)

      const due = dueDays === '' ? null : Number(dueDays)
      const { data, error } = replacing
        ? await supabase.rpc('rpc_install_replacement', {
            p_qr_code: code,
            p_replaces_installation_id: replacing.installationId,
            p_due_days: due,
          })
        : await supabase.rpc('rpc_install_product', {
            p_qr_code: code,
            p_bay_id: location.bayId,
            p_due_days: due,
          })

      if (error) {
        const msg = friendlyError(error)
        setLastError(msg)
        toast('error', msg)
      } else {
        const product = data as unknown as ProductView
        setDone((d) => [product, ...d])
        toast(
          'success',
          replacing
            ? `${product.qr_code} hung — replaces ${replacing.qrCode}`
            : `${product.qr_code} installed · change due ${formatDate(product.due_date)}`,
        )
        if (replacing) stopReplacing()
        void reload()
        void loadBayStatus(location.bayId)
      }

      busyRef.current = false
      setBusy(false)
    },
    [location.bayId, dueDays, replacing, toast, reload, loadBayStatus, stopReplacing],
  )

  const { hardwareSeen } = useHidScanner(install, !busy)

  const showNext = done.length > 0 && bayStatus && bayStatus.bayId === location.bayId && selectedBay

  // On a phone the follow-up lands below the fold; bring it up after each install.
  useEffect(() => {
    if (showNext) nextRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [showNext, done.length])

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Install</h1>
          <p className="page-sub">Register where a product has been fitted</p>
        </div>
      </div>

      <Card className="step-card step-1">
        <SectionTitle>
          <span className="step-num">1</span> Where are you working?
        </SectionTitle>
        <LocationPicker value={location} onChange={setLocation} disabled={busy || !!replacing} />

        {selectedBay && (
          <p className="location-confirm">
            <strong>{selectedBay.hospital_name}</strong> → {selectedBay.floor} → {selectedBay.ward_name} →{' '}
            <strong>{selectedBay.bay_name}</strong>
            <br />
            <span className="muted">{selectedBay.active_products} product(s) currently in this bay</span>
          </p>
        )}

        <button
          type="button"
          className="link-button"
          onClick={() => setShowAdvanced((v) => !v)}
          aria-expanded={showAdvanced}
        >
          {showAdvanced ? 'Hide' : 'Change'} the change-due window
        </button>

        {showAdvanced && (
          <div className="field">
            <label className="field-label" htmlFor="due-days">
              Days until change due
            </label>
            <input
              id="due-days"
              className="input"
              type="number"
              min={1}
              max={365}
              inputMode="numeric"
              placeholder="180 (default)"
              value={dueDays}
              onChange={(e) => setDueDays(e.target.value === '' ? '' : Number(e.target.value))}
            />
            <p className="field-hint">Leave blank to use the standard change-due window.</p>
          </div>
        )}
      </Card>

      <Card className="step-card step-2">
        <SectionTitle>
          <span className="step-num">2</span> {replacing ? 'Scan the replacement' : 'Scan the product'}
        </SectionTitle>

        {replacing && (
          <div className="replacing-banner">
            <p>
              Replacing <strong>{replacing.qrCode}</strong>, taken down from{' '}
              <strong>{replacing.where}</strong>. The next scan hangs its replacement here.
            </p>
            <button type="button" className="link-button" onClick={stopReplacing}>
              Not a replacement
            </button>
          </div>
        )}

        <ScanField
          onSubmit={install}
          hardwareSeen={hardwareSeen}
          busy={busy}
          autoFocus
          disabled={!location.bayId}
          label="Scan or type the QR / barcode"
        />
        {!location.bayId && <p className="field-hint">Pick a bay above to start scanning.</p>}
        {lastError && (
          <p className="form-error" role="alert">
            {lastError}
          </p>
        )}
      </Card>

      {showNext && (
        <div ref={nextRef} className="next-anchor">
          <Card className="next-card">
            <div className="next-head">
              <span className="next-icon" aria-hidden="true">
                <IconDown />
              </span>
              <div>
                <h2>Taking something down in {selectedBay.bay_name}?</h2>
                <p className="next-sub">
                  {bayStatus.inPlace} in place
                  {bayStatus.overdue > 0 ? ` · ${bayStatus.overdue} overdue` : ' · none overdue'}
                </p>
              </div>
            </div>
            <Link className="btn btn-primary btn-block" to={takeDownHereUrl(location.bayId)}>
              Take down in this bay
            </Link>
          </Card>
        </div>
      )}

      <Card className="step-card step-3">
        <SectionTitle
          action={
            done.length > 0 ? (
              <button type="button" className="link-button" onClick={() => setDone([])}>
                Clear
              </button>
            ) : undefined
          }
        >
          <span className="step-num">3</span> Installed this session ({done.length})
        </SectionTitle>
        {done.length === 0 ? (
          <EmptyState title="Nothing installed yet" hint="Scanned products will appear here as you go." />
        ) : (
          <ul className="result-list">
            {done.map((p) => (
              <li key={p.installation_id ?? p.id}>
                <Link to={`/inventory/${p.id}`} className="result-row">
                  <span className="result-code">{p.qr_code}</span>
                  <span className="result-meta">
                    {p.ward_name} · {p.bay_name}
                  </span>
                  <span className="badge badge-due-ok">Due {formatDate(p.due_date)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

function IconDown() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 21V10" />
      <path d="m8 14 4-4 4 4" />
      <path d="M4 7V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2" />
    </svg>
  )
}
