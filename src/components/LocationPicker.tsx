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
 * Hospital → Floor → Ward → Bay, each level filtered by the one above.
 * Single-option levels are chosen automatically so a hospital login with one
 * site never has to tap a dropdown that has only one answer.
 */
export default function LocationPicker({
  value,
  onChange,
  requireBay = true,
  disabled = false,
}: {
  value: LocationSelection
  onChange: (next: LocationSelection) => void
  requireBay?: boolean
  disabled?: boolean
}) {
  const { hospitals, floorsFor, wardsFor, baysFor, loading } = useData()

  const floors = value.hospitalId ? floorsFor(value.hospitalId) : []
  const wards = value.hospitalId && value.floor ? wardsFor(value.hospitalId, value.floor) : []
  const bays = value.wardId ? baysFor(value.wardId) : []

  // Collapse levels that have exactly one possible answer.
  useEffect(() => {
    if (loading) return
    if (!value.hospitalId && hospitals.length === 1) {
      onChange({ ...EMPTY_LOCATION, hospitalId: hospitals[0].id })
      return
    }
    if (value.hospitalId && !value.floor && floors.length === 1) {
      onChange({ ...value, floor: floors[0], wardId: '', bayId: '' })
      return
    }
    if (value.floor && !value.wardId && wards.length === 1) {
      onChange({ ...value, wardId: wards[0].id, bayId: '' })
    }
  }, [loading, hospitals, floors, wards, value, onChange])

  return (
    <div className="location-picker">
      <Field label="Hospital" htmlFor="loc-hospital">
        <select
          id="loc-hospital"
          className="input"
          value={value.hospitalId}
          disabled={disabled || loading}
          onChange={(e) => onChange({ ...EMPTY_LOCATION, hospitalId: e.target.value })}
        >
          <option value="">{loading ? 'Loading…' : 'Select hospital'}</option>
          {hospitals.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Floor" htmlFor="loc-floor">
        <select
          id="loc-floor"
          className="input"
          value={value.floor}
          disabled={disabled || !value.hospitalId}
          onChange={(e) => onChange({ ...value, floor: e.target.value, wardId: '', bayId: '' })}
        >
          <option value="">Select floor</option>
          {floors.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Ward" htmlFor="loc-ward">
        <select
          id="loc-ward"
          className="input"
          value={value.wardId}
          disabled={disabled || !value.floor}
          onChange={(e) => onChange({ ...value, wardId: e.target.value, bayId: '' })}
        >
          <option value="">Select ward</option>
          {wards.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </Field>

      {requireBay && (
        <Field label="Bay" htmlFor="loc-bay">
          <select
            id="loc-bay"
            className="input"
            value={value.bayId}
            disabled={disabled || !value.wardId}
            onChange={(e) => onChange({ ...value, bayId: e.target.value })}
          >
            <option value="">Select bay</option>
            {bays.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
                {b.active_products > 0 ? ` · ${b.active_products} in place` : ''}
              </option>
            ))}
          </select>
        </Field>
      )}
    </div>
  )
}
