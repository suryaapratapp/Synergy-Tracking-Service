import type { LocationSelection } from '../components/LocationPicker'
import type { LocationRow } from './types'

/** A full picker selection for one bay, so a screen can open "already there". */
export function selectionForBay(row: LocationRow | undefined): LocationSelection | null {
  if (!row) return null
  return { hospitalId: row.hospital_id, floor: row.floor, wardId: row.ward_id, bayId: row.bay_id }
}

/**
 * Where something is or goes. Only the hospital is required; ward and bay are
 * recorded when the fitter chooses them.
 */
export interface Place {
  hospitalId: string
  hospitalName: string
  wardId: string | null
  wardName: string | null
  floor: string | null
  bayId: string | null
  bayName: string | null
}

export function describePlace(p: Pick<Place, 'hospitalName' | 'wardName' | 'bayName'>): string {
  return [p.hospitalName, p.wardName, p.bayName].filter(Boolean).join(' · ')
}

/** Just the part below the hospital: "Cardiology Ward · Bay C1" (or the hospital itself if nothing more is known). */
export function shortPlace(p: Pick<Place, 'hospitalName' | 'wardName' | 'bayName'>): string {
  return [p.wardName, p.bayName].filter(Boolean).join(' · ') || p.hospitalName
}

export function placeOf(row: {
  hospital_id: string
  hospital_name: string
  ward_id: string | null
  ward_name: string | null
  floor: string | null
  bay_id: string | null
  bay_name: string | null
}): Place {
  return {
    hospitalId: row.hospital_id,
    hospitalName: row.hospital_name,
    wardId: row.ward_id,
    wardName: row.ward_name,
    floor: row.floor,
    bayId: row.bay_id,
    bayName: row.bay_name,
  }
}

export function describeBay(row: {
  hospital_name: string | null
  ward_name: string | null
  bay_name: string | null
}): string {
  return [row.hospital_name, row.ward_name, row.bay_name].filter(Boolean).join(' · ')
}

/** Install screen, opened on this bay - optionally hanging a replacement. */
export function installHereUrl(bayId: string, replacesInstallationId?: string): string {
  const q = new URLSearchParams({ bay: bayId })
  if (replacesInstallationId) q.set('replaces', replacesInstallationId)
  return `/install?${q.toString()}`
}

/** Take-down screen, opened on this bay in By-location mode. */
export function takeDownHereUrl(bayId: string): string {
  return `/takedown?${new URLSearchParams({ bay: bayId }).toString()}`
}
