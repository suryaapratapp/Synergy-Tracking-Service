import { describeBay } from '../lib/location'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase, friendlyError, fetchAllRows } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import { useHidScanner } from '../hooks/useHidScanner'
import { Card, DueBadge, EmptyState, SectionTitle, Spinner, StatusBadge, useToast } from '../components/ui'
import { StatTile } from '../components/Charts'
import { downloadCsv, toCsv } from '../lib/csv'
import { formatDate, normaliseCode, pluralise } from '../lib/format'
import {
  BOX_STATUS_LABELS,
  type ProductCounts,
  type ProductView,
  type StockBox,
} from '../lib/types'

const PAGE_SIZE = 40

type FilterKey = 'all' | 'in_use' | 'overdue' | 'due' | 'stock' | 'removed' | 'retired'

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'in_use', label: 'In use' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'due', label: 'Due soon' },
  { key: 'stock', label: 'In stock' },
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
  const [boxes, setBoxes] = useState<StockBox[]>([])
  const [counts, setCounts] = useState<ProductCounts | null>(null)
  const [count, setCount] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)

  /** Stock is held as boxes, so that filter reads a different table entirely. */
  const showingStock = filter === 'stock'

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
        // `hospital_id` is only set when the live installation is visible to the
        // caller, so this keeps a hospital's list to what is fitted at its site.
        case 'in_use':
          query = query.eq('status', 'in_use').not('hospital_id', 'is', null)
          break
        case 'overdue':
          query = query.eq('status', 'in_use').not('hospital_id', 'is', null).lt('due_date', today)
          break
        case 'due': {
          // Matches the dashboard's "Due in 30 days" tile.
          const soon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
          query = query
            .eq('status', 'in_use')
            .not('hospital_id', 'is', null)
            .gte('due_date', today)
            .lte('due_date', soon)
          break
        }
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

    if (showingStock) {
      let q = supabase.from('v_stock_boxes').select('*').order('packed_at', { ascending: false })
      if (hospital) q = q.eq('hospital_id', hospital)
      if (debounced) q = q.ilike('box_code', `%${debounced}%`)
      const { data, error } = await q
      if (error) toast('error', friendlyError(error))
      else {
        setBoxes((data ?? []) as StockBox[])
        setCount((data ?? []).length)
      }
      setLoading(false)
      return
    }

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
  }, [showingStock, buildQuery, page, toast, hospital, debounced])

  useEffect(() => {
    void load()
  }, [load])

  // Summary card figures, scoped the same way the list is.
  const loadCounts = useCallback(async () => {
    const { data, error } = await supabase.rpc('rpc_product_counts', {
      p_hospital_id: hospital || null,
    })
    if (!error && data) setCounts(data as ProductCounts)
  }, [hospital])

  useEffect(() => {
    void loadCounts()
  }, [loadCounts])

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

    if (showingStock) {
      const csv = toCsv(
        ['Box', 'Product code', 'Product', 'Quantity', 'Hospital', 'Invoice', 'Status', 'Packed', 'Dispatched', 'Delivered'],
        boxes.map((b) => [
          b.box_code,
          b.product_code,
          b.product_type,
          b.quantity,
          b.hospital_name,
          b.invoice_ref,
          BOX_STATUS_LABELS[b.status],
          formatDate(b.packed_at),
          b.dispatched_at ? formatDate(b.dispatched_at) : '',
          b.delivered_at ? formatDate(b.delivered_at) : '',
        ]),
      )
      downloadCsv(`stock-boxes-${new Date().toISOString().slice(0, 10)}.csv`, csv)
      toast('success', `Exported ${pluralise(boxes.length, 'box', 'boxes')}`)
      setExporting(false)
      return
    }

    const { rows: list, error } = await fetchAllRows<ProductView>((from, to) =>
      buildQuery(false).order('qr_code').range(from, to),
    )
    if (error) {
      toast('error', friendlyError(error))
    } else {
      const csv = toCsv(
        ['Code', 'Product code', 'Type', 'Status', 'Hospital', 'Floor', 'Ward', 'Bay', 'Installed', 'Change due', 'Days left', 'Batch', 'Size', 'Colour'],
        list.map((p) => [
          p.qr_code,
          p.product_code,
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
      toast('success', `Exported ${pluralise(list.length, 'product')}`)
    }
    setExporting(false)
  }

  const pageCount = Math.max(1, Math.ceil(count / PAGE_SIZE))
  const filterLabel = useMemo(() => FILTERS.find((f) => f.key === filter)?.label ?? 'All', [filter])

  const subtitle = showingStock
    ? counts
      ? `${counts.boxes_in_stock} in stock · ${counts.boxes_dispatched} in transit · ${counts.boxes_delivered} delivered`
      : pluralise(count, 'box', 'boxes')
    : `${count} ${filterLabel.toLowerCase()} ${count === 1 ? 'product' : 'products'}`

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Products</h1>
          <p className="page-sub">{subtitle}</p>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => void exportCsv()}
          disabled={exporting || count === 0}
        >
          {exporting ? 'Exporting…' : 'Export CSV'}
        </button>
      </div>

      {counts && (
        <div className="stat-grid stat-grid-6">
          <StatTile
            label="Total"
            value={counts.all}
            hint="On the system"
            tone={filter === 'all' ? 'accent' : 'neutral'}
            onClick={() => setParam('filter', '')}
          />
          <StatTile
            label="In use"
            value={counts.in_use}
            hint="Currently fitted"
            tone={filter === 'in_use' ? 'accent' : 'neutral'}
            onClick={() => setParam('filter', 'in_use')}
          />
          <StatTile
            label="Overdue"
            value={counts.overdue}
            hint="Past change-due"
            tone={counts.overdue > 0 ? 'critical' : 'neutral'}
            onClick={() => setParam('filter', 'overdue')}
          />
          <StatTile
            label="Due in 30 days"
            value={counts.due}
            hint="Plan the round"
            tone={counts.due > 0 ? 'warning' : 'neutral'}
            onClick={() => setParam('filter', 'due')}
          />
          <StatTile
            label="In stock"
            value={counts.boxes_in_stock}
            hint={`${counts.items_in_stock} items boxed`}
            tone={filter === 'stock' ? 'accent' : 'neutral'}
            onClick={() => setParam('filter', 'stock')}
          />
          <StatTile
            label="Taken down"
            value={counts.removed}
            hint="Out of service"
            tone={filter === 'removed' ? 'accent' : 'neutral'}
            onClick={() => setParam('filter', 'removed')}
          />
        </div>
      )}

      <div className="search-row">
        <input
          className="input"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={showingStock ? 'Search by box number' : 'Search by code — or just scan'}
          aria-label="Search"
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
      {hardwareSeen && !showingStock && (
        <p className="scan-status is-live">
          <span className="dot" />
          Scanner connected — scan to open a product
        </p>
      )}

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

      {showingStock ? (
        <StockBoxes boxes={boxes} loading={loading} counts={counts} />
      ) : (
        <>
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
                          {p.hospital_name
                            ? describeBay(p)
                            : 'Not installed'}
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
              <button
                type="button"
                className="btn btn-ghost"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
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
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------- stock */

function StockBoxes({
  boxes,
  loading,
  counts,
}: {
  boxes: StockBox[]
  loading: boolean
  counts: ProductCounts | null
}) {
  const grouped = useMemo(
    () => ({
      in_stock: boxes.filter((b) => b.status === 'in_stock'),
      dispatched: boxes.filter((b) => b.status === 'dispatched'),
      delivered: boxes.filter((b) => b.status === 'delivered'),
    }),
    [boxes],
  )

  if (loading) return <Spinner label="Loading stock" />

  return (
    <>
      <Card>
        <SectionTitle>Stock is held as boxes</SectionTitle>
        <p className="card-sub">
          Product is packed into a box, invoiced to a hospital and shipped. The items inside are
          scanned and installed on arrival, so stock is counted in boxes rather than loose items.
        </p>
        <p className="notice notice-info">
          Placeholder data — this section will read from Synergy's inventory barcode system once
          it is connected.
        </p>
        {counts && (
          <ul className="kv-list">
            <li>
              <span>Boxes in stock</span>
              <strong>{counts.boxes_in_stock}</strong>
            </li>
            <li>
              <span>Items boxed and ready</span>
              <strong>{counts.items_in_stock}</strong>
            </li>
            <li>
              <span>Boxes in transit</span>
              <strong>{counts.boxes_dispatched}</strong>
            </li>
            <li>
              <span>Boxes delivered</span>
              <strong>{counts.boxes_delivered}</strong>
            </li>
          </ul>
        )}
      </Card>

      {(['in_stock', 'dispatched', 'delivered'] as const).map((status) =>
        grouped[status].length === 0 ? null : (
          <Card key={status} className="card-flush">
            <div className="box-group-head">
              <h2>{BOX_STATUS_LABELS[status]}</h2>
              <span className="muted">
                {pluralise(grouped[status].length, 'box', 'boxes')} ·{' '}
                {grouped[status].reduce((s, b) => s + b.quantity, 0)} items
              </span>
            </div>
            <ul className="box-list">
              {grouped[status].map((b) => (
                <li key={b.id} className="box-row">
                  <span className="box-main">
                    <span className="box-code">{b.box_code}</span>
                    <span className="box-meta">
                      {b.hospital_name ?? 'Not yet allocated'}
                      {b.invoice_ref && ` · ${b.invoice_ref}`}
                    </span>
                    {b.notes && <span className="box-note">{b.notes}</span>}
                  </span>
                  <span className="box-side">
                    <span className="box-qty">
                      {b.quantity}
                      <small>items</small>
                    </span>
                    <span className={`badge badge-box-${b.status}`}>{BOX_STATUS_LABELS[b.status]}</span>
                    <span className="box-date">
                      {b.status === 'delivered' && b.delivered_at
                        ? `Delivered ${formatDate(b.delivered_at)}`
                        : b.status === 'dispatched' && b.dispatched_at
                          ? `Sent ${formatDate(b.dispatched_at)}`
                          : `Packed ${formatDate(b.packed_at)}`}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ),
      )}

      {boxes.length === 0 && (
        <Card>
          <EmptyState title="No boxes to show" hint="Nothing is in stock for this site." />
        </Card>
      )}
    </>
  )
}
