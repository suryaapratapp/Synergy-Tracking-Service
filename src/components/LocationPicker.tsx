import { useEffect } from 'react'
import { useData } from '../context/DataContext'
import { Field } from './ui'

export interface LocationSelection {
  hospitalId: string
  floor: string
  wardId: string
  bayId: string
}

export const EMPTY_LOCATION: LocationSelection = { hospitalId: '', floor: '', wardId: '', bayId: '' }

/**
 * Hospital first - the only one that must be filled in. Choosing it reveals
 * Floor, then Ward, then Bay, each appearing only once the one above has an
 * answer. Floor, ward and bay are optional: a fitter who just picks the
 * hospital can carry straight on.
 *
 * A single hospital (a hospital login) and a single floor are chosen
 * automatically, so there is never a dropdown with only one answer.
 */
export default function LocationPicker({
  value,
  onChange,
  disabled = false,
  hospitalLabel = 'Hospital',
}: {
  value: LocationSelection
  onChange: (next: LocationSelection) => void
  disabled?: boolean
  hospitalLabel?: string
}) {
  const { hospitals, floorsFor, wardsFor, baysFor, loading } = useData()

  const floors = value.hospitalId ? floorsFor(value.hospitalId) : []
  const wards = value.hospitalId && value.floor ? wardsFor(value.hospitalId, value.floor) : []
  const bays = value.wardId ? baysFor(value.wardId) : []

  useEffect(() => {
    if (loading) return
    if (!value.hospitalId && hospitals.length === 1) {
      onChange({ ...EMPTY_LOCATION, hospitalId: hospitals[0].id })
      return
    }
    if (value.hospitalId && !value.floor && floors.length === 1) {
      onChange({ ...value, floor: floors[0], wardId: '', bayId: '' })
    }
  }, [loading, hospitals, floors, value, onChange])

  return (
    <div className="location-picker">
      <Field label={hospitalLabel} htmlFor="loc-hospital" required className="loc-full">
        <select
          id="loc-hospital"
          className="input"
          value={value.hospitalId}
          disabled={disabled || loading}
          onChange={(e) => onChange({ ...EMPTY_LOCATION, hospitalId: e.target.value })}
        >
          <option value="">{loading ? 'Loading…' : 'Choose hospital'}</option>
          {hospitals.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </select>
      </Field>

      {value.hospitalId && floors.length > 0 && (
        <Field label="Floor" htmlFor="loc-floor" className="loc-half loc-floor">
          <select
            id="loc-floor"
            className="input"
            value={value.floor}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, floor: e.target.value, wardId: '', bayId: '' })}
          >
            <option value="">Choose floor</option>
            {floors.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </Field>
      )}

      {value.floor && wards.length > 0 && (
        <Field label="Ward" htmlFor="loc-ward" className="loc-half loc-ward">
          <select
            id="loc-ward"
            className="input"
            value={value.wardId}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, wardId: e.target.value, bayId: '' })}
          >
            <option value="">Choose ward</option>
            {wards.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      {value.wardId && bays.length > 0 && (
        <Field label="Bay" htmlFor="loc-bay" className="loc-full">
          <select
            id="loc-bay"
            className="input"
            value={value.bayId}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, bayId: e.target.value })}
          >
            <option value="">Choose bay</option>
            {bays.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
      )}
    </div>
  )
}
