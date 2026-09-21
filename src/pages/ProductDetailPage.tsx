import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase, friendlyError } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import { Card, DueBadge, EmptyState, Sheet, Spinner, StatusBadge, SectionTitle, useToast } from '../components/ui'
import { formatDate, formatDateTime } from '../lib/format'
import { describeBay, installHereUrl } from '../lib/location'
import { REMOVAL_REASONS, type InstallationView, type ProductView, type RemovalReason } from '../lib/types'

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const toast = useToast()
  const { isGlobal } = useAuth()
  const { reload } = useData()

  const [product, setProduct] = useState<ProductView | null>(null)
  const [history, setHistory] = useState<InstallationView[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [sheet, setSheet] = useState<'takedown' | 'retire' | null>(null)
  const [reason, setReason] = useState<RemovalReason>('expired')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [justRemoved, setJustRemoved] = useState<{ installationId: string; bayId: string; where: string } | null>(
    null,
  )

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)

    const [{ data: p, error: pe }, { data: h }] = await Promise.all([
      supabase.from('v_products').select('*').eq('id', id).maybeSingle(),
      supabase.from('v_installations').select('*').eq('product_id', id).order('installed_at', { ascending: false }),
    ])

    if (pe) toast('error', friendlyError(pe))
    if (!p) setNotFound(true)
    else setProduct(p as ProductView)
    setHistory((h ?? []) as InstallationView[])
    setLoading(false)
  }, [id, toast])

  useEffect(() => {
    void load()
  }, [load])

  const takeDown = async () => {
    if (!product?.installation_id) return
    setBusy(true)
    const { error } = await supabase.rpc('rpc_takedown', {
      p_installation_ids: [product.installation_id],
      p_reason: reason,
      p_notes: notes.trim() || null,
    })
    if (error) toast('error', friendlyError(error))
    else {
      toast('success', `${product.qr_code} taken down`)
      if (product.bay_id) {
        setJustRemoved({
          installationId: product.installation_id,
          bayId: product.bay_id,
          where: describeBay(product),
        })
      }
      setSheet(null)
      setNotes('')
      void load()
      void reload()
    }
    setBusy(false)
  }

  const retire = async () => {
    if (!product) return
    setBusy(true)
    const { error } = await supabase.rpc('rpc_set_product_status', {
      p_product_id: product.id,
      p_status: 'retired',
      p_notes: notes.trim() || null,
    })
    if (error) toast('error', friendlyError(error))
    else {
      toast('success', `${product.qr_code} retired`)
      setSheet(null)
      setNotes('')
      void load()
    }
    setBusy(false)
  }

  if (loading) return <Spinner label="Loading product" />
  if (notFound || !product) {
    return (
      <div className="page">
        <EmptyState
          title="Product not found"
          hint="It may not exist, or it may belong to another site."
          action={
            <button type="button" className="btn btn-primary" onClick={() => navigate('/inventory')}>
              Back to products
            </button>
          }
        />
      </div>
    )
  }

  return (
    <div className="page">
      <button type="button" className="link-button back" onClick={() => navigate(-1)}>
        ← Back
      </button>

      <div className="detail-head">
        <h1>{product.qr_code}</h1>
        <div className="detail-badges">
          <StatusBadge status={product.status} />
          {product.status === 'in_use' && <DueBadge days={product.days_remaining} />}
        </div>
      </div>

      {justRemoved && (
        <Card className="next-card">
          <div className="next-head">
            <span className="next-icon" aria-hidden="true">
              ↻
            </span>
            <div>
              <h2>Hang a replacement?</h2>
              <p className="next-sub">{justRemoved.where}</p>
            </div>
          </div>
          <Link
            className="btn btn-primary btn-block"
            to={installHereUrl(justRemoved.bayId, justRemoved.installationId)}
          >
            Hang the replacement in this bay
          </Link>
          <button type="button" className="link-button" onClick={() => setJustRemoved(null)}>
            Not replacing it
          </button>
        </Card>
      )}

      {product.status === 'in_use' && (
        <Card className="card-highlight">
          <SectionTitle>Currently installed</SectionTitle>
          <p className="detail-location">
            <strong>{product.hospital_name}</strong>
            <br />
            {product.floor} · {product.ward_name} · <strong>{product.bay_name}</strong>
          </p>
          <ul className="kv-list">
            <li>
              <span>Installed</span>
              <strong>{formatDateTime(product.installed_at)}</strong>
            </li>
            <li>
              <span>Installed by</span>
              <strong>{product.installed_by_name ?? '—'}</strong>
            </li>
            <li>
              <span>Change due</span>
              <strong>{formatDate(product.due_date)}</strong>
            </li>
          </ul>
          <button type="button" className="btn btn-primary btn-block" onClick={() => setSheet('takedown')}>
            Take this product down
          </button>
        </Card>
      )}

      <Card>
        <SectionTitle>Product details</SectionTitle>
        <ul className="kv-list">
          <li>
            <span>Type</span>
            <strong>{product.product_type}</strong>
          </li>
          <li>
            <span>Batch</span>
            <strong>{product.batch ?? '—'}</strong>
          </li>
          <li>
            <span>Size</span>
            <strong>{product.size ?? '—'}</strong>
          </li>
          <li>
            <span>Colour</span>
            <strong>{product.colour ?? '—'}</strong>
          </li>
          <li>
            <span>Registered</span>
            <strong>{formatDate(product.registered_at)}</strong>
          </li>
          <li>
            <span>Registered by</span>
            <strong>{product.registered_by_name ?? '—'}</strong>
          </li>
          <li>
            <span>Times installed</span>
            <strong>{history.length}</strong>
          </li>
        </ul>

        {isGlobal && product.status !== 'in_use' && product.status !== 'retired' && (
          <button type="button" className="btn btn-ghost btn-block" onClick={() => setSheet('retire')}>
            Retire this product
          </button>
        )}
      </Card>

      <Card>
        <SectionTitle>Full history</SectionTitle>
        {history.length === 0 ? (
          <EmptyState title="Never installed" hint="This product is still in stock." />
        ) : (
          <ol className="timeline">
            {history.map((h) => (
              <li key={h.id} className={h.state === 'active' ? 'is-active' : ''}>
                <div className="timeline-dot" aria-hidden="true" />
                <div className="timeline-body">
                  <p className="timeline-title">
                    {h.hospital_name} · {h.ward_name} · {h.bay_name}
                  </p>
                  <p className="timeline-meta">
                    Installed {formatDateTime(h.installed_at)}
                    {h.installed_by_name && ` by ${h.installed_by_name}`}
                  </p>
                  {h.replaces_qr_code && (
                    <p className="timeline-meta timeline-swap">Hung as the replacement for {h.replaces_qr_code}</p>
                  )}
                  {h.removed_at ? (
                    <p className="timeline-meta">
                      Taken down {formatDateTime(h.removed_at)}
                      {h.removed_by_name && ` by ${h.removed_by_name}`} —{' '}
                      <strong>{reasonLabel(h.removal_reason)}</strong>
                      {h.removal_notes && <em> · {h.removal_notes}</em>}
                    </p>
                  ) : (
                    <p className="timeline-meta">
                      Still in place · change due {formatDate(h.due_date)}
                    </p>
                  )}
                  {h.replaced_by_qr_code && (
                    <p className="timeline-meta timeline-swap">Replaced by {h.replaced_by_qr_code}</p>
                  )}
                  <p className="timeline-meta muted">{h.days_in_service} days in service</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Sheet
        open={sheet === 'takedown'}
        title="Take down"
        onClose={() => setSheet(null)}
        footer={
          <button type="button" className="btn btn-primary btn-lg btn-block" onClick={() => void takeDown()} disabled={busy}>
            {busy ? 'Working…' : `Confirm take-down — ${reasonLabel(reason)}`}
          </button>
        }
      >
        <p className="sheet-lead">
          <strong>{product.qr_code}</strong> at {product.ward_name} · {product.bay_name}
        </p>
        <div className="reason-group" role="radiogroup" aria-label="Reason for removal">
          {REMOVAL_REASONS.map((r) => (
            <button
              key={r.value}
              type="button"
              role="radio"
              aria-checked={reason === r.value}
              className={`reason ${reason === r.value ? 'is-active' : ''}`}
              onClick={() => setReason(r.value)}
            >
              <span className="reason-label">{r.label}</span>
              <span className="reason-help">{r.help}</span>
            </button>
          ))}
        </div>
        <div className="field">
          <label className="field-label" htmlFor="detail-notes">
            Notes <span className="muted">(optional)</span>
          </label>
          <textarea
            id="detail-notes"
            className="input"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </Sheet>

      <Sheet
        open={sheet === 'retire'}
        title="Retire product"
        onClose={() => setSheet(null)}
        footer={
          <button type="button" className="btn btn-danger btn-lg btn-block" onClick={() => void retire()} disabled={busy}>
            {busy ? 'Working…' : 'Retire permanently'}
          </button>
        }
      >
        <p className="sheet-lead">
          Retiring takes <strong>{product.qr_code}</strong> out of circulation. It will no longer be available to
          install.
        </p>
        <div className="field">
          <label className="field-label" htmlFor="retire-notes">
            Reason <span className="muted">(optional)</span>
          </label>
          <textarea
            id="retire-notes"
            className="input"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. end of life, sent for recycling"
          />
        </div>
      </Sheet>
    </div>
  )
}

function reasonLabel(r: RemovalReason | null): string {
  if (!r) return '—'
  return REMOVAL_REASONS.find((x) => x.value === r)?.label ?? r
}
