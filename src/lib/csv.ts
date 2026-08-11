/**
 * Small dependency-free CSV reader/writer.
 * Handles quoted fields, embedded commas/newlines, and both CRLF and LF.
 */

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0

  // Strip a UTF-8 BOM - Excel adds one and it corrupts the first header.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)

  while (i < text.length) {
    const ch = text[i]

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }

    if (ch === '"') {
      inQuotes = true
      i++
      continue
    }
    if (ch === ',') {
      row.push(field)
      field = ''
      i++
      continue
    }
    if (ch === '\r') {
      i++
      continue
    }
    if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i++
      continue
    }
    field += ch
    i++
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

/**
 * Reads a location CSV into { hospital, floor, ward, bay } records.
 * Column order does not matter; headers are matched loosely so Synergy's
 * own export can be dropped in without editing.
 */
export interface LocationImportRow {
  hospital: string
  floor: string
  ward: string
  bay: string
  code?: string
}

export function parseLocationCsv(text: string): {
  rows: LocationImportRow[]
  errors: string[]
} {
  const table = parseCsv(text)
  const errors: string[] = []
  if (table.length < 2) return { rows: [], errors: ['The file has no data rows.'] }

  const header = table[0].map((h) => h.trim().toLowerCase())
  const find = (...names: string[]) =>
    header.findIndex((h) => names.some((n) => h === n || h.replace(/[^a-z]/g, '') === n))

  const iHospital = find('hospital', 'hospitalname', 'site', 'sitename')
  const iFloor = find('floor', 'level')
  const iWard = find('ward', 'wardname', 'department')
  const iBay = find('bay', 'bayname', 'bed', 'room', 'location')
  const iCode = find('code', 'hospitalcode', 'sitecode')

  if (iHospital < 0) errors.push('Missing a "Hospital" column.')
  if (iWard < 0) errors.push('Missing a "Ward" column.')
  if (iBay < 0) errors.push('Missing a "Bay" column.')
  if (errors.length) return { rows: [], errors }

  const rows: LocationImportRow[] = []
  for (let r = 1; r < table.length; r++) {
    const cells = table[r]
    const hospital = (cells[iHospital] ?? '').trim()
    const ward = (cells[iWard] ?? '').trim()
    const bay = (cells[iBay] ?? '').trim()
    const floor = iFloor >= 0 ? (cells[iFloor] ?? '').trim() || 'Ground' : 'Ground'
    const code = iCode >= 0 ? (cells[iCode] ?? '').trim() : ''

    if (!hospital || !ward || !bay) {
      errors.push(`Row ${r + 1} skipped - hospital, ward and bay are all required.`)
      continue
    }
    rows.push({ hospital, floor, ward, bay, ...(code ? { code } : {}) })
  }

  return { rows, errors }
}

function escapeCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  return [headers.map(escapeCell).join(','), ...rows.map((r) => r.map(escapeCell).join(','))].join('\r\n')
}

export function downloadCsv(filename: string, csv: string): void {
  // The BOM keeps Excel happy with UTF-8.
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
