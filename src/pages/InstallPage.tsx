import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, friendlyError } from '../lib/supabase'
import { useData } from '../context/DataContext'
import { useHidScanner } from '../hooks/useHidScanner'
import ScanField from '../components/ScanField'
import LocationPicker, { EMPTY_LOCATION, type LocationSelection } from '../components/LocationPicker'
import { Card, EmptyState, SectionTitle, useToast } from '../components/ui'
import { formatDate } from '../lib/format'
import type { ProductView } from '../lib/types'

const LOCATION_KEY = 'synergy.lastInstallLocation'

/**
 * Location first, then scan repeatedly. A fitter working a bay sets the
 * location once and then just pulls the trigger for each curtain.
 */
export default function InstallPage() {
  const { bay, reload } = useData()
  const toast = useToast()

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
  const busyRef = useRef(false)

  useEffect(() => {
    if (location.bayId) localStorage.setItem(LOCATION_KEY, JSON.stringify(location))
  }, [location])

  const selectedBay = location.bayId ? bay(location.bayId) : undefined

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

      const { data, error } = await supabase.rpc('rpc_install_product', {
        p_qr_code: code,
        p_bay_id: location.bayId,
        p_due_days: dueDays === '' ? null : Number(dueDays),
      })

      if (error) {
        const msg = friendlyError(error)
        setLastError(msg)
        toast('error', msg)
      } else {
        const product = data as unknown as ProductView
        setDone((d) => [product, ...d])
        toast('success', `${product.qr_code} installed · change due ${formatDate(product.due_date)}`)
        void reload()
      }

      busyRef.current = false
      setBusy(false)
    },
    [location.bayId, dueDays, toast, reload],
  )

  const { hardwareSeen } = useHidScanner(install, !busy)

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
        <LocationPicker value={location} onChange={setLocation} disabled={busy} />

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
          <span className="step-num">2</span> Scan the product
        </SectionTitle>
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
