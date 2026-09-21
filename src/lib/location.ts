import type { LocationSelection } from '../components/LocationPicker'
import type { LocationRow } from './types'

/** A full picker selection for one bay, so a screen can open "already there". */
export function selectionForBay(row: LocationRow | undefined): LocationSelection | null {
  if (!row) return null
  return { hospitalId: row.hospital_id, floor: row.floor, wardId: row.ward_id, bayId: row.bay_id }
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
