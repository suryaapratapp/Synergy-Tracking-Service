import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase, friendlyError, fetchAllRows } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import { useHidScanner } from '../hooks/useHidScanner'
import { Card, DueBadge, EmptyState, Spinner, StatusBadge, useToast } from '../components/ui'
import { downloadCsv, toCsv } from '../lib/csv'
import { formatDate, normaliseCode } from '../lib/format'
import type { ProductView } from '../lib/types'

const PAGE_SIZE = 40

type FilterKey = 'all' | 'in_use' | 'overdue' | 'due' | 'registered' | 'removed' | 'retired'

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'in_use', label: 'In use' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'due', label: 'Due soon' },
  { key: 'registered', label: 'In stock' },
  { key: 'removed', label: 'Taken down' },
  { key: 'retired', label: 'Retired' },
]

export default function InventoryPage() {
  const [params, setParams] = useSearchParams()
  const { isGlobal } = useAuth()
  const { hospitals } = useData()
  const navigate = useNavigate()
  const toast = useToast()

  const filter = (params.get('filter') as FilterKey) || 'all'
  const hospital = params.get('hospital') ?? ''
  const [search, setSearch] = useState(params.get('q') ?? '')
  const [debounced, setDebounced] = useState(search)

  const [rows, setRows] = useState<ProductView[]>([])
  const [count, setCount] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 250)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    setPage(0)
  }, [filter, hospital, debounced])

  /** Builds a v_products query with the active filter chips applied. */
  const buildQuery = useCallback(
    (withCount: boolean) => {
      let query = withCount
        ? supabase.from('v_products').select('*', { count: 'exact' })
        : supabase.from('v_products').select('*')

      const today = new Date().toISOString().slice(0, 10)

      switch (filter) {
        case 'in_use':
          query = query.eq('status', 'in_use')
          break
        case 'overdue':
          query = query.eq('status', 'in_use').lt('due_date', today)
          break
        case 'due': {
          // Matches the dashboard's "Due in 30 days" tile.
          const soon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
          query = query.eq('status', 'in_use').gte('due_date', today).lte('due_date', soon)
          break
        }
        case 'registered':
        case 'removed':
        case 'retired':
          query = query.eq('status', filter)
          break
        default:
          break
      }

      if (hospital) query = query.eq('hospital_id', hospital)
      if (debounced) query = query.ilike('qr_code', `%${normaliseCode(debounced)}%`)
      return query
    },
    [filter, hospital, debounced],
  )

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error, count: total } = await buildQuery(true)
      .order('is_overdue', { ascending: false })
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('qr_code', { ascending: true })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)

    if (error) toast('error', friendlyError(error))
    else {
      setRows((data ?? []) as ProductView[])
      setCount(total ?? 0)
    }
    setLoading(false)
  }, [buildQuery, page, toast])

  useEffect(() => {
    void load()
  }, [load])

  // A scan anywhere on this page jumps straight to that product.
  const findByCode = useCallback(
    async (code: string) => {
      const { data } = await supabase.from('v_products').select('id').eq('qr_code', code).maybeSingle()
      if (data?.id) navigate(`/inventory/${data.id}`)
      else {
        setSearch(code)
        toast('info', `No product found for ${code}`)
      }
    },
    [navigate, toast],
  )
  const { hardwareSeen } = useHidScanner(findByCode)

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  const exportCsv = async () => {
    setExporting(true)
    const { rows: list, error } = await fetchAllRows<ProductView>((from, to) =>
      buildQuery(false).order('qr_code').range(from, to),
    )
    if (error) {
      toast('error', friendlyError(error))
    } else {
      const csv = toCsv(
        ['Code', 'Type', 'Status', 'Hospital', 'Floor', 'Ward', 'Bay', 'Installed', 'Change due', 'Days left', 'Batch', 'Size', 'Colour'],
        list.map((p) => [
          p.qr_code,
          p.product_type,
          p.status,
          p.hospital_name,
          p.floor,
          p.ward_name,
          p.bay_name,
          p.installed_at ? formatDate(p.installed_at) : '',
          p.due_date ? formatDate(p.due_date) : '',
          p.days_remaining,
          p.batch,
          p.size,
          p.colour,
        ]),
      )
      downloadCsv(`products-${filter}-${new Date().toISOString().slice(0, 10)}.csv`, csv)
      toast('success', `Exported ${list.length} products`)
    }
    setExporting(false)
  }

  const pageCount = Math.max(1, Math.ceil(count / PAGE_SIZE))
  const filterLabel = useMemo(() => FILTERS.find((f) => f.key === filter)?.label ?? 'All', [filter])

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Products</h1>
          <p className="page-sub">
            {count} {filterLabel.toLowerCase()} {count === 1 ? 'product' : 'products'}
          </p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void exportCsv()} disabled={exporting}>
          {exporting ? 'Exporting…' : 'Export CSV'}
        </button>
      </div>

      <div className="search-row">
        <input
          className="input"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by code — or just scan"
          aria-label="Search products"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          enterKeyHint="search"
        />
        {search && (
          <button type="button" className="btn btn-icon" onClick={() => setSearch('')} aria-label="Clear search">
            ✕
          </button>
        )}
      </div>
      {hardwareSeen && <p className="scan-status is-live"><span className="dot" />Scanner connected — scan to open a product</p>}

      <div className="chip-row" role="tablist" aria-label="Filter products">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={filter === f.key}
            className={`chip ${filter === f.key ? 'is-active' : ''}`}
            onClick={() => setParam('filter', f.key === 'all' ? '' : f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isGlobal && hospitals.length > 1 && (
        <select
          className="input input-compact"
          value={hospital}
          onChange={(e) => setParam('hospital', e.target.value)}
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

      <Card className="card-flush">
        {loading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No products match"
            hint={debounced ? `Nothing found for "${debounced}".` : 'Try a different filter.'}
          />
        ) : (
          <ul className="product-list">
            {rows.map((p) => (
              <li key={p.id}>
                <Link to={`/inventory/${p.id}`} className="product-row">
                  <span className="product-main">
                    <span className="product-code">{p.qr_code}</span>
                    <span className="product-loc">
                      {p.hospital_name ? `${p.hospital_name} · ${p.ward_name} · ${p.bay_name}` : 'Not installed'}
                    </span>
                  </span>
                  <span className="product-side">
                    <StatusBadge status={p.status} />
                    {p.status === 'in_use' && <DueBadge days={p.days_remaining} />}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {pageCount > 1 && (
        <div className="pager">
          <button type="button" className="btn btn-ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            Previous
          </button>
          <span>
            Page {page + 1} of {pageCount}
          </span>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={page + 1 >= pageCount}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}
