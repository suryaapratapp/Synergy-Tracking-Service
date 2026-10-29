import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, friendlyError, fetchAllRows } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import { BarChart, StatTile } from '../components/Charts'
import { Card, EmptyState, SectionTitle, Spinner, useToast } from '../components/ui'
import { downloadCsv, toCsv } from '../lib/csv'
import { formatDate, formatDateTime, pluralise } from '../lib/format'
import { REMOVAL_REASONS, type InstallationView, type RemovalReason } from '../lib/types'

type ReportKind = 'takedowns' | 'installations' | 'in_service'
type RangeKey = '7' | '30' | '90' | '365' | 'all'

const RANGES: { key: RangeKey; label: string }[] = [
  { key: '7', label: 'Last 7 days' },
  { key: '30', label: 'Last 30 days' },
  { key: '90', label: 'Last 90 days' },
  { key: '365', label: 'Last 12 months' },
  { key: 'all', label: 'All time' },
]

const KINDS: { key: ReportKind; label: string }[] = [
  { key: 'takedowns', label: 'Take-downs' },
  { key: 'installations', label: 'Installations' },
  { key: 'in_service', label: 'Currently in service' },
]

export default function ReportsPage() {
  const { isGlobal } = useAuth()
  const { hospitals } = useData()
  const toast = useToast()

  const [kind, setKind] = useState<ReportKind>('takedowns')
  const [range, setRange] = useState<RangeKey>('90')
  const [hospital, setHospital] = useState('')
  const [reason, setReason] = useState<RemovalReason | ''>('')
  const [rows, setRows] = useState<InstallationView[]>([])
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(true)

  const since = useMemo(() => {
    if (range === 'all') return null
    return new Date(Date.now() - Number(range) * 86400000).toISOString()
  }, [range])

  const buildQuery = useCallback(() => {
    let query = supabase.from('v_installations').select('*')

    if (kind === 'takedowns') {
      query = query.not('removed_at', 'is', null)
      if (since) query = query.gte('removed_at', since)
      if (reason) query = query.eq('removal_reason', reason)
      query = query.order('removed_at', { ascending: false })
    } else if (kind === 'installations') {
      if (since) query = query.gte('installed_at', since)
      query = query.order('installed_at', { ascending: false })
    } else {
      query = query.is('removed_at', null).order('due_date', { ascending: true })
    }

    if (hospital) query = query.eq('hospital_id', hospital)
    return query
  }, [kind, since, reason, hospital])

  const load = useCallback(async () => {
    setLoading(true)
    const { rows: all, truncated: cut, error } = await fetchAllRows<InstallationView>((from, to) =>
      buildQuery().range(from, to),
    )
    if (error) toast('error', friendlyError(error))
    else {
      setRows(all)
      setTruncated(cut)
    }
    setLoading(false)
  }, [buildQuery, toast])

  useEffect(() => {
    void load()
  }, [load])

  const summary = useMemo(() => {
    const byReason = new Map<string, number>()
    const byHospital = new Map<string, number>()
    const byWard = new Map<string, number>()
    let serviceDays = 0
    let serviceCount = 0

    for (const r of rows) {
      if (r.removal_reason) byReason.set(r.removal_reason, (byReason.get(r.removal_reason) ?? 0) + 1)
      byHospital.set(r.hospital_name, (byHospital.get(r.hospital_name) ?? 0) + 1)
      const wardKey = `${r.ward_name ?? 'No ward recorded'}|${r.hospital_name}`
      byWard.set(wardKey, (byWard.get(wardKey) ?? 0) + 1)
      if (r.removed_at) {
        serviceDays += r.days_in_service
        serviceCount += 1
      }
    }

    return {
      byReason,
      byHospital: [...byHospital.entries()].sort((a, b) => b[1] - a[1]),
      byWard: [...byWard.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
      avgService: serviceCount ? Math.round((serviceDays / serviceCount) * 10) / 10 : null,
      earlyRemovals: rows.filter((r) => r.removal_reason && r.removal_reason !== 'expired').length,
    }
  }, [rows])

  const exportCsv = () => {
    const csv = toCsv(
      [
        'Code',
        'Type',
        'Hospital',
        'Floor',
        'Ward',
        'Bay',
        'Installed',
        'Installed by',
        'Change due',
        'Taken down',
        'Taken down by',
        'Reason',
        'Notes',
        'Days in service',
      ],
      rows.map((r) => [
        r.qr_code,
        r.product_type,
        r.hospital_name,
        r.floor,
        r.ward_name,
        r.bay_name,
        formatDateTime(r.installed_at),
        r.installed_by_name,
        formatDate(r.due_date),
        r.removed_at ? formatDateTime(r.removed_at) : '',
        r.removed_by_name,
        r.removal_reason ? reasonLabel(r.removal_reason) : '',
        r.removal_notes,
        r.days_in_service,
      ]),
    )
    downloadCsv(`report-${kind}-${new Date().toISOString().slice(0, 10)}.csv`, csv)
    toast('success', `Exported ${pluralise(rows.length, 'row')}`)
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Reports</h1>
          <p className="page-sub">
            {pluralise(rows.length, 'record')} in this view
            {truncated && ' (capped — narrow the period)'}
          </p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={exportCsv} disabled={rows.length === 0}>
          Export CSV
        </button>
      </div>

      <div className="chip-row" role="tablist" aria-label="Report type">
        {KINDS.map((k) => (
          <button
            key={k.key}
            type="button"
            role="tab"
            aria-selected={kind === k.key}
            className={`chip ${kind === k.key ? 'is-active' : ''}`}
            onClick={() => setKind(k.key)}
          >
            {k.label}
          </button>
        ))}
      </div>

      <Card>
        <div className="filter-grid">
          {kind !== 'in_service' && (
            <div className="field">
              <label className="field-label" htmlFor="rng">
                Period
              </label>
              <select id="rng" className="input" value={range} onChange={(e) => setRange(e.target.value as RangeKey)}>
                {RANGES.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {isGlobal && hospitals.length > 1 && (
            <div className="field">
              <label className="field-label" htmlFor="hosp">
                Hospital
              </label>
              <select id="hosp" className="input" value={hospital} onChange={(e) => setHospital(e.target.value)}>
                <option value="">All sites</option>
                {hospitals.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {kind === 'takedowns' && (
            <div className="field">
              <label className="field-label" htmlFor="rsn">
                Reason
              </label>
              <select
                id="rsn"
                className="input"
                value={reason}
                onChange={(e) => setReason(e.target.value as RemovalReason | '')}
              >
                <option value="">All reasons</option>
                {REMOVAL_REASONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </Card>

      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState title="Nothing to report" hint="Try a wider period or a different filter." />
        </Card>
      ) : (
        <>
          <div className="stat-grid">
            <StatTile label="Records" value={rows.length} tone="accent" />
            {kind === 'takedowns' && (
              <>
                <StatTile
                  label="Early removals"
                  value={summary.earlyRemovals}
                  tone={summary.earlyRemovals > 0 ? 'warning' : 'neutral'}
                  hint="Soiled or damaged"
                />
                <StatTile
                  label="Avg. service life"
                  value={summary.avgService ? `${summary.avgService}d` : '—'}
                  hint="Install to take-down"
                />
              </>
            )}
            {kind === 'in_service' && (
              <>
                <StatTile
                  label="Overdue"
                  value={rows.filter((r) => new Date(r.due_date) < new Date()).length}
                  tone="critical"
                />
                <StatTile label="Sites" value={new Set(rows.map((r) => r.hospital_id)).size} />
              </>
            )}
            {kind === 'installations' && (
              <StatTile label="Sites" value={new Set(rows.map((r) => r.hospital_id)).size} />
            )}
          </div>

          <div className="chart-grid">
            {kind === 'takedowns' && summary.byReason.size > 0 && (
              <Card>
                <SectionTitle>Reasons</SectionTitle>
                <BarChart
                  showLegend={false}
                  data={REMOVAL_REASONS.filter((r) => summary.byReason.has(r.value)).map((r, i) => ({
                    label: r.label,
                    sublabel: r.help,
                    values: [
                      {
                        value: summary.byReason.get(r.value) ?? 0,
                        token: `--series-${i + 1}`,
                        name: r.label,
                      },
                    ],
                  }))}
                />
              </Card>
            )}

            {summary.byHospital.length > 0 && (
              <Card>
                <SectionTitle>By hospital</SectionTitle>
                <BarChart
                  showLegend={false}
                  data={summary.byHospital.map(([name, value]) => ({
                    label: name,
                    values: [{ value, token: '--series-1', name: 'Records' }],
                  }))}
                />
              </Card>
            )}

            {summary.byWard.length > 0 && (
              <Card>
                <SectionTitle>Top wards</SectionTitle>
                <BarChart
                  showLegend={false}
                  data={summary.byWard.map(([key, value]) => {
                    const [ward, hosp] = key.split('|')
                    return {
                      label: ward,
                      sublabel: isGlobal ? hosp : undefined,
                      values: [{ value, token: '--series-1', name: 'Records' }],
                    }
                  })}
                />
              </Card>
            )}
          </div>

          <Card className="card-flush">
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Location</th>
                    <th>Installed</th>
                    {kind === 'takedowns' ? <th>Taken down</th> : <th>Change due</th>}
                    {kind === 'takedowns' && <th>Reason</th>}
                    <th>Days</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 200).map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Link to={`/inventory/${r.product_id}`} className="link">
                          {r.qr_code}
                        </Link>
                      </td>
                      <td>
                        <span className="cell-main">
                          {[r.ward_name, r.bay_name].filter(Boolean).join(' · ') || 'No ward recorded'}
                        </span>
                        <span className="cell-sub">{r.hospital_name}</span>
                      </td>
                      <td>{formatDate(r.installed_at)}</td>
                      <td>{kind === 'takedowns' ? formatDate(r.removed_at) : formatDate(r.due_date)}</td>
                      {kind === 'takedowns' && (
                        <td>
                          <span className={`badge badge-reason-${r.removal_reason}`}>
                            {reasonLabel(r.removal_reason)}
                          </span>
                        </td>
                      )}
                      <td className="num">{r.days_in_service}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length > 200 && (
              <p className="table-note">
                Showing the first 200 of {rows.length}. Export to CSV for the full set.
              </p>
            )}
          </Card>
        </>
      )}
    </div>
  )
}

function reasonLabel(r: RemovalReason | null): string {
  if (!r) return '—'
  return REMOVAL_REASONS.find((x) => x.value === r)?.label ?? r
}
