import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase, friendlyError } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import type { DashboardData } from '../lib/types'
import { REMOVAL_REASONS } from '../lib/types'
import { dueLabel, formatDate, relativeTime } from '../lib/format'
import { BarChart, DonutChart, LineChart, StatTile } from '../components/Charts'
import { Card, EmptyState, SectionTitle, Spinner } from '../components/ui'

export default function DashboardPage() {
  const { profile, isGlobal } = useAuth()
  const { hospitals } = useData()
  const navigate = useNavigate()

  const [scope, setScope] = useState<string>('')
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data: res, error: err } = await supabase.rpc('rpc_dashboard', {
      p_hospital_id: scope || null,
    })
    if (err) setError(friendlyError(err))
    else {
      setData(res as DashboardData)
      setError(null)
    }
    setLoading(false)
  }, [scope])

  useEffect(() => {
    void load()
  }, [load])

  if (loading && !data) return <Spinner label="Loading dashboard" />
  if (error && !data) return <EmptyState title="Could not load the dashboard" hint={error} />
  if (!data) return null

  const t = data.totals
  const reasonLabel = (r: string) => REMOVAL_REASONS.find((x) => x.value === r)?.label ?? r

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Overview</h1>
          <p className="page-sub">
            {profile?.role === 'hospital'
              ? 'Your site at a glance'
              : scope
                ? hospitals.find((h) => h.id === scope)?.name
                : 'All sites'}
          </p>
        </div>

        {isGlobal && hospitals.length > 1 && (
          <select
            className="input input-compact"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            aria-label="Filter by hospital"
          >
            <option value="">All sites</option>
            {hospitals.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="quick-actions">
        <button type="button" className="quick quick-install" onClick={() => navigate('/install')}>
          <span className="quick-title">Install</span>
          <span className="quick-sub">Scan a label and fit it</span>
        </button>
        <button type="button" className="quick quick-takedown" onClick={() => navigate('/takedown')}>
          <span className="quick-title">Take down</span>
          <span className="quick-sub">Pick a bay and log the reason</span>
        </button>
      </div>

      <div className="stat-grid">
        <StatTile label="In use" value={t.in_use} tone="accent" hint="Currently installed" />
        <StatTile
          label="Overdue"
          value={t.overdue}
          tone={t.overdue > 0 ? 'critical' : 'neutral'}
          hint="Past change-due date"
          onClick={() => navigate('/inventory?filter=overdue')}
        />
        <StatTile
          label="Due in 30 days"
          value={t.due_30}
          tone={t.due_30 > 0 ? 'warning' : 'neutral'}
          hint="Plan the next round"
          onClick={() => navigate('/inventory?filter=due')}
        />
        <StatTile label="In stock" value={t.in_stock} hint="Registered, not yet fitted" />
      </div>

      <div className="chart-grid">
        <Card>
          <SectionTitle>Fleet composition</SectionTitle>
          <DonutChart
            centreLabel="Products"
            data={[
              { label: 'In use', value: t.in_use, token: '--series-1' },
              { label: 'In stock', value: t.in_stock, token: '--series-3' },
              { label: 'Taken down', value: t.removed, token: '--series-2' },
              { label: 'Retired', value: t.retired, token: '--series-4' },
            ]}
          />
        </Card>

        <Card>
          <SectionTitle>Installs vs take-downs</SectionTitle>
          <p className="card-sub">Last 12 months</p>
          <LineChart
            labels={data.trend.map((m) => m.label)}
            series={[
              { name: 'Installed', token: '--series-1', points: data.trend.map((m) => m.installed) },
              { name: 'Taken down', token: '--series-2', points: data.trend.map((m) => m.removed) },
            ]}
          />
        </Card>

        {data.by_reason.length > 0 && (
          <Card>
            <SectionTitle>Why products came down</SectionTitle>
            <p className="card-sub">Last 12 months</p>
            <BarChart
              showLegend={false}
              data={data.by_reason.map((r, i) => ({
                label: reasonLabel(r.reason),
                sublabel: REMOVAL_REASONS.find((x) => x.value === r.reason)?.help,
                values: [{ value: r.count, token: `--series-${i + 1}`, name: reasonLabel(r.reason) }],
              }))}
            />
          </Card>
        )}

        {isGlobal && data.by_hospital.length > 0 && (
          <Card>
            <SectionTitle>By hospital</SectionTitle>
            <BarChart
              data={data.by_hospital.map((h) => ({
                label: h.name,
                values: [
                  { value: h.in_use, token: '--series-1', name: 'In use' },
                  { value: h.overdue, token: '--status-critical', name: 'Overdue' },
                ],
              }))}
            />
          </Card>
        )}

        {data.by_ward.length > 0 && (
          <Card>
            <SectionTitle>Busiest wards</SectionTitle>
            <BarChart
              data={data.by_ward.slice(0, 8).map((w) => ({
                label: w.name,
                sublabel: isGlobal ? `${w.hospital} · ${w.floor}` : w.floor,
                values: [
                  { value: w.in_use, token: '--series-1', name: 'In use' },
                  { value: w.overdue, token: '--status-critical', name: 'Overdue' },
                ],
              }))}
            />
          </Card>
        )}

        <Card>
          <SectionTitle>Service performance</SectionTitle>
          <ul className="kv-list">
            <li>
              <span>Average time in service</span>
              <strong>{t.avg_service_days ? `${t.avg_service_days} days` : '—'}</strong>
            </li>
            <li>
              <span>Installed in last 30 days</span>
              <strong>{t.installed_30}</strong>
            </li>
            <li>
              <span>Taken down in last 30 days</span>
              <strong>{t.removed_30}</strong>
            </li>
            <li>
              <span>Sites covered</span>
              <strong>{t.hospitals}</strong>
            </li>
            <li>
              <span>Products on the system</span>
              <strong>{t.products}</strong>
            </li>
          </ul>
        </Card>
      </div>

      <Card>
        <SectionTitle action={<Link to="/inventory?filter=due" className="link">View all</Link>}>
          Needs attention
        </SectionTitle>
        {data.due_soon.length === 0 ? (
          <EmptyState title="Nothing due in the next 30 days" hint="Every product is inside its change window." />
        ) : (
          <ul className="due-list">
            {data.due_soon.slice(0, 8).map((d) => (
              <li key={d.installation_id}>
                <Link to={`/inventory/${d.product_id}`} className="due-row">
                  <span className="due-code">{d.qr_code}</span>
                  <span className="due-loc">
                    {d.hospital} · {d.ward} · {d.bay}
                  </span>
                  <span className={`badge badge-due-${d.days < 0 ? 'danger' : d.days <= 3 ? 'warn' : 'ok'}`}>
                    {dueLabel(d.days)}
                  </span>
                  <span className="due-date">{formatDate(d.due_date)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <SectionTitle>Recent activity</SectionTitle>
        {data.recent.length === 0 ? (
          <EmptyState title="No activity yet" />
        ) : (
          <ul className="activity">
            {data.recent.map((e) => (
              <li key={e.id}>
                <span className={`act-dot act-${e.type}`} aria-hidden="true" />
                <span className="act-body">
                  <strong>{e.qr_code ?? 'Product'}</strong> {describeEvent(e.type, e.detail)}
                  {e.hospital && <span className="muted"> · {e.hospital}</span>}
                </span>
                <time className="act-time">{relativeTime(e.at)}</time>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="credit">Developed by RZ Circular Ltd</p>
    </div>
  )
}

function describeEvent(type: string, detail: Record<string, unknown>): string {
  switch (type) {
    case 'registered':
      return 'was registered'
    case 'installed':
      return 'was installed'
    case 'removed': {
      const reason = String(detail?.reason ?? '')
      const label = REMOVAL_REASONS.find((r) => r.value === reason)?.label
      return label ? `was taken down — ${label.toLowerCase()}` : 'was taken down'
    }
    case 'status_changed':
      return `status changed to ${String(detail?.status ?? '')}`
    default:
      return type.replace(/_/g, ' ')
  }
}
