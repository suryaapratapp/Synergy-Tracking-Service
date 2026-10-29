import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '../context/DataContext'
import { useAuth } from '../context/AuthContext'
import { useHidScanner } from '../hooks/useHidScanner'
import ScanField from '../components/ScanField'
import LocationPicker, { EMPTY_LOCATION, type LocationSelection } from '../components/LocationPicker'
import { Card, useToast } from '../components/ui'
import { formatDate } from '../lib/format'
import { installProduct, type InstalledItem } from '../lib/offline/actions'

const LOCATION_KEY = 'synergy.lastInstallLocation'

/**
 * New curtains only. Replacing one that is already up is done from Take down,
 * which removes the old one and hangs the new one in a single flow.
 *
 * The hospital is required; floor, ward and bay may be left out.
 */
export default function InstallPage() {
  const { placeFor } = useData()
  const { isGuest } = useAuth()
  const toast = useToast()

  const [location, setLocation] = useState<LocationSelection>(() => {
    try {
      const saved = localStorage.getItem(LOCATION_KEY)
      return saved ? (JSON.parse(saved) as LocationSelection) : EMPTY_LOCATION
    } catch {
      return EMPTY_LOCATION
    }
  })
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<InstalledItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const busyRef = useRef(false)

  useEffect(() => {
    if (location.hospitalId) localStorage.setItem(LOCATION_KEY, JSON.stringify(location))
  }, [location])

  const install = useCallback(
    async (code: string) => {
      if (busyRef.current) return
      const place = placeFor(location)
      if (!place) {
        setError('Choose a hospital first.')
        return
      }

      busyRef.current = true
      setBusy(true)
      setError(null)
      try {
        const item = await installProduct({ code, place, dueDays: null })
        setDone((d) => [item, ...d])
        toast(
          item.queued ? 'info' : 'success',
          item.queued ? `${item.qr_code} saved on this phone` : `${item.qr_code} installed`,
        )
      } catch (err) {
        // Shown in red under the scan field; a pop-up on top of it would only hide it.
        setError((err as Error).message)
      } finally {
        busyRef.current = false
        setBusy(false)
      }
    },
    [location, placeFor, toast],
  )

  useHidScanner(install, !busy && !!location.hospitalId)

  return (
    <div className="page page-tight">
      <div className="page-head">
        <div>
          <h1>Install</h1>
          <p className="page-sub">New curtains</p>
        </div>
      </div>

      <Card className="tight-card">
        <h2 className="mini-title">Where are you working?</h2>
        <LocationPicker value={location} onChange={setLocation} disabled={busy} />
      </Card>

      <Card className="tight-card">
        <ScanField
          onSubmit={install}
          busy={busy}
          autoFocus
          label="Scan the new curtain"
          disabled={!location.hospitalId}
          hint={location.hospitalId ? null : 'Choose a hospital first'}
          error={error}
        />
      </Card>

      {done.length > 0 && (
        <Card className="tight-card">
          <div className="mini-head">
            <h2 className="mini-title">Installed ({done.length})</h2>
            <button type="button" className="link-button" onClick={() => setDone([])}>
              Clear
            </button>
          </div>
          <ul className="result-list">
            {done.map((p) => {
              const body = (
                <>
                  <span className="result-code">{p.qr_code}</span>
                  <span className="result-meta">{p.place}</span>
                  {p.queued ? (
                    <span className="badge badge-queued">On this phone</span>
                  ) : (
                    <span className="badge badge-due-ok">Due {formatDate(p.due_date)}</span>
                  )}
                </>
              )
              return (
                <li key={p.key}>
                  {isGuest || !p.id ? (
                    <div className="result-row">{body}</div>
                  ) : (
                    <Link to={`/inventory/${p.id}`} className="result-row">
                      {body}
                    </Link>
                  )}
                </li>
              )
            })}
          </ul>
        </Card>
      )}
    </div>
  )
}
