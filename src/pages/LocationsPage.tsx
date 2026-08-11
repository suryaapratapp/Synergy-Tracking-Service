import { useMemo, useRef, useState } from 'react'
import { supabase, friendlyError } from '../lib/supabase'
import { useData } from '../context/DataContext'
import { Card, EmptyState, SectionTitle, Spinner, useToast } from '../components/ui'
import { downloadCsv, parseLocationCsv, toCsv, type LocationImportRow } from '../lib/csv'

interface ImportResult {
  hospitals: number
  wards: number
  bays: number
  skipped: number
}

export default function LocationsPage() {
  const { locations, hospitals, loading, reload } = useData()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)

  const [pending, setPending] = useState<LocationImportRow[] | null>(null)
  const [issues, setIssues] = useState<string[]>([])
  const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  const tree = useMemo(() => {
    const byHospital = new Map<
      string,
      { name: string; floors: Map<string, Map<string, { name: string; bays: string[]; inUse: number }>> }
    >()

    for (const l of locations) {
      if (!byHospital.has(l.hospital_id)) byHospital.set(l.hospital_id, { name: l.hospital_name, floors: new Map() })
      const h = byHospital.get(l.hospital_id)!
      if (!h.floors.has(l.floor)) h.floors.set(l.floor, new Map())
      const f = h.floors.get(l.floor)!
      if (!f.has(l.ward_id)) f.set(l.ward_id, { name: l.ward_name, bays: [], inUse: 0 })
      const w = f.get(l.ward_id)!
      w.bays.push(l.bay_name)
      w.inUse += l.active_products
    }
    return byHospital
  }, [locations])

  const onFile = async (file: File) => {
    setResult(null)
    setFileName(file.name)
    const text = await file.text()
    const { rows, errors } = parseLocationCsv(text)
    setPending(rows.length > 0 ? rows : null)
    setIssues(errors)
    if (rows.length === 0) toast('error', errors[0] ?? 'No usable rows found in that file.')
  }

  const runImport = async () => {
    if (!pending) return
    setBusy(true)
    const { data, error } = await supabase.rpc('rpc_import_locations', { p_rows: pending })
    if (error) {
      toast('error', friendlyError(error))
    } else {
      const res = data as unknown as ImportResult
      setResult(res)
      setPending(null)
      setFileName('')
      if (fileRef.current) fileRef.current.value = ''
      toast('success', `Imported ${res.bays} new bays across ${res.wards} wards`)
      await reload()
    }
    setBusy(false)
  }

  const downloadTemplate = () => {
    const csv = toCsv(
      ['Hospital', 'Code', 'Floor', 'Ward', 'Bay'],
      [
        ['Queen Mary Hospital', 'QMH', 'Ground', 'Emergency Ward', 'Bay E1'],
        ['Queen Mary Hospital', 'QMH', 'Ground', 'Emergency Ward', 'Bay E2'],
        ['Queen Mary Hospital', 'QMH', 'Level 1', 'Surgical Ward', 'Bay S1'],
      ],
    )
    downloadCsv('location-import-template.csv', csv)
  }

  const exportCurrent = () => {
    const csv = toCsv(
      ['Hospital', 'Code', 'Floor', 'Ward', 'Bay', 'Products in place'],
      locations.map((l) => [l.hospital_name, l.hospital_code, l.floor, l.ward_name, l.bay_name, l.active_products]),
    )
    downloadCsv(`locations-${new Date().toISOString().slice(0, 10)}.csv`, csv)
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Locations</h1>
          <p className="page-sub">
            {hospitals.length} {hospitals.length === 1 ? 'hospital' : 'hospitals'} · {locations.length} bays
          </p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={exportCurrent} disabled={locations.length === 0}>
          Export CSV
        </button>
      </div>

      <Card>
        <SectionTitle>Import a location list</SectionTitle>
        <p className="card-sub">
          Upload Synergy's CSV for a hospital. Columns needed: <strong>Hospital</strong>, <strong>Floor</strong>,{' '}
          <strong>Ward</strong>, <strong>Bay</strong> (an optional <strong>Code</strong> column sets the hospital's
          short code). Existing locations are left untouched — only new ones are added.
        </p>

        <div className="import-actions">
          <label className="btn btn-primary file-btn">
            Choose CSV file
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void onFile(f)
              }}
            />
          </label>
          <button type="button" className="btn btn-ghost" onClick={downloadTemplate}>
            Download template
          </button>
        </div>

        {issues.length > 0 && (
          <ul className="error-list">
            {issues.slice(0, 8).map((e) => (
              <li key={e}>{e}</li>
            ))}
            {issues.length > 8 && <li>…and {issues.length - 8} more</li>}
          </ul>
        )}

        {pending && (
          <div className="import-preview">
            <p>
              <strong>{fileName}</strong> — {pending.length} rows ready to import
            </p>
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Hospital</th>
                    <th>Floor</th>
                    <th>Ward</th>
                    <th>Bay</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.slice(0, 8).map((r, i) => (
                    <tr key={`${r.hospital}-${r.ward}-${r.bay}-${i}`}>
                      <td>{r.hospital}</td>
                      <td>{r.floor}</td>
                      <td>{r.ward}</td>
                      <td>{r.bay}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pending.length > 8 && <p className="table-note">…and {pending.length - 8} more rows</p>}
            <button type="button" className="btn btn-primary btn-block" onClick={() => void runImport()} disabled={busy}>
              {busy ? 'Importing…' : `Import ${pending.length} rows`}
            </button>
          </div>
        )}

        {result && (
          <div className="import-result">
            <p>
              Added <strong>{result.hospitals}</strong> hospitals, <strong>{result.wards}</strong> wards and{' '}
              <strong>{result.bays}</strong> bays.
              {result.skipped > 0 && ` ${result.skipped} rows were skipped.`}
            </p>
          </div>
        )}
      </Card>

      <Card>
        <SectionTitle>Current locations</SectionTitle>
        {loading ? (
          <Spinner />
        ) : tree.size === 0 ? (
          <EmptyState title="No locations yet" hint="Import a CSV above to get started." />
        ) : (
          <ul className="tree">
            {[...tree.entries()].map(([id, h]) => {
              const bayCount = [...h.floors.values()].reduce(
                (s, f) => s + [...f.values()].reduce((t, w) => t + w.bays.length, 0),
                0,
              )
              const open = expanded === id
              return (
                <li key={id}>
                  <button
                    type="button"
                    className="tree-head"
                    onClick={() => setExpanded(open ? null : id)}
                    aria-expanded={open}
                  >
                    <span>
                      <strong>{h.name}</strong>
                      <small>
                        {h.floors.size} floors · {bayCount} bays
                      </small>
                    </span>
                    <span className="tree-chevron">{open ? '−' : '+'}</span>
                  </button>

                  {open && (
                    <div className="tree-body">
                      {[...h.floors.entries()].map(([floor, wards]) => (
                        <div key={floor} className="tree-floor">
                          <h4>{floor}</h4>
                          <ul>
                            {[...wards.values()].map((w) => (
                              <li key={w.name}>
                                <span className="tree-ward">{w.name}</span>
                                <span className="tree-bays">{w.bays.join(', ')}</span>
                                {w.inUse > 0 && <span className="badge badge-in_use">{w.inUse} in use</span>}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </div>
  )
}
