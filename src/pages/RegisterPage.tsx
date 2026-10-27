import { useCallback, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, friendlyError } from '../lib/supabase'
import { useHidScanner } from '../hooks/useHidScanner'
import ScanField from '../components/ScanField'
import { Card, EmptyState, Field, SectionTitle, useToast } from '../components/ui'
import { normaliseCode } from '../lib/format'
import type { ProductView } from '../lib/types'

/**
 * Applying labels at the Synergy site. Attributes are set once and reused for
 * every scan in the run, so labelling a pallet is scan-scan-scan.
 */
export default function RegisterPage() {
  const toast = useToast()

  const [batch, setBatch] = useState('')
  const [size, setSize] = useState('')
  const [colour, setColour] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<ProductView[]>([])
  const [bulk, setBulk] = useState('')
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkResult, setBulkResult] = useState<{ ok: number; failed: string[] } | null>(null)
  const busyRef = useRef(false)

  const register = useCallback(
    async (code: string) => {
      if (busyRef.current) return
      busyRef.current = true
      setBusy(true)

      const { data, error } = await supabase.rpc('rpc_register_product', {
        p_qr_code: code,
        p_batch: batch.trim() || null,
        p_size: size.trim() || null,
        p_colour: colour.trim() || null,
      })

      if (error) {
        toast('error', friendlyError(error))
      } else {
        const product = data as unknown as ProductView
        setDone((d) => [product, ...d])
        toast('success', `${product.qr_code} registered`)
      }

      busyRef.current = false
      setBusy(false)
    },
    [batch, size, colour, toast],
  )

  const { hardwareSeen } = useHidScanner(register, !busy && !bulkOpen)

  const registerBulk = async () => {
    const codes = Array.from(
      new Set(
        bulk
          .split(/[\n,;\t]+/)
          .map(normaliseCode)
          .filter(Boolean),
      ),
    )
    if (codes.length === 0) return

    setBusy(true)
    setBulkResult(null)
    const failed: string[] = []
    let ok = 0

    for (const code of codes) {
      const { error } = await supabase.rpc('rpc_register_product', {
        p_qr_code: code,
        p_batch: batch.trim() || null,
        p_size: size.trim() || null,
        p_colour: colour.trim() || null,
      })
      if (error) failed.push(`${code} — ${friendlyError(error)}`)
      else ok += 1
    }

    setBulkResult({ ok, failed })
    setBusy(false)
    if (ok > 0) toast('success', `${ok} product${ok === 1 ? '' : 's'} registered`)
    if (failed.length > 0) toast('error', `${failed.length} could not be registered`)
    if (failed.length === 0) setBulk('')
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Register labels</h1>
          <p className="page-sub">Bring newly labelled products onto the system</p>
        </div>
      </div>

      <Card>
        <SectionTitle>Batch details</SectionTitle>
        <p className="card-sub">Applied to everything you register in this run. All optional.</p>
        <div className="form-grid">
          <Field label="Batch reference" htmlFor="batch">
            <input
              id="batch"
              className="input"
              value={batch}
              onChange={(e) => setBatch(e.target.value)}
              placeholder="e.g. B-2026-08"
              autoComplete="off"
            />
          </Field>
          <Field label="Size" htmlFor="size">
            <input
              id="size"
              className="input"
              value={size}
              onChange={(e) => setSize(e.target.value)}
              placeholder="e.g. 3000 x 2000"
              autoComplete="off"
            />
          </Field>
          <Field label="Colour" htmlFor="colour">
            <input
              id="colour"
              className="input"
              value={colour}
              onChange={(e) => setColour(e.target.value)}
              placeholder="e.g. Sky Blue"
              autoComplete="off"
            />
          </Field>
        </div>
      </Card>

      <Card>
        <SectionTitle>Scan each label</SectionTitle>
        <ScanField
          onSubmit={register}
          hardwareSeen={hardwareSeen}
          busy={busy}
          autoFocus
          disabled={bulkOpen}
          label="Scan or type the QR / barcode"
        />
        <button type="button" className="link-button" onClick={() => setBulkOpen((v) => !v)}>
          {bulkOpen ? 'Back to scanning' : 'Register a list of codes instead'}
        </button>

        {bulkOpen && (
          <div className="bulk">
            <Field label="One code per line" htmlFor="bulk">
              <textarea
                id="bulk"
                className="input"
                rows={6}
                value={bulk}
                onChange={(e) => setBulk(e.target.value)}
                placeholder={'RZCIR-MVN191-AAA001\nRZCIR-MVN191-AAA002\nRZCIR-MVN191-AAA003'}
                spellCheck={false}
              />
            </Field>
            <button
              type="button"
              className="btn btn-primary btn-block"
              onClick={() => void registerBulk()}
              disabled={busy || !bulk.trim()}
            >
              {busy ? 'Registering…' : 'Register all'}
            </button>

            {bulkResult && (
              <div className="bulk-result">
                <p>
                  <strong>{bulkResult.ok}</strong> registered
                  {bulkResult.failed.length > 0 && `, ${bulkResult.failed.length} skipped`}
                </p>
                {bulkResult.failed.length > 0 && (
                  <ul className="error-list">
                    {bulkResult.failed.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </Card>

      <Card>
        <SectionTitle
          action={
            done.length > 0 ? (
              <button type="button" className="link-button" onClick={() => setDone([])}>
                Clear
              </button>
            ) : undefined
          }
        >
          Registered this session ({done.length})
        </SectionTitle>
        {done.length === 0 ? (
          <EmptyState title="Nothing registered yet" hint="Scanned labels will appear here." />
        ) : (
          <ul className="result-list">
            {done.map((p) => (
              <li key={p.id}>
                <Link to={`/inventory/${p.id}`} className="result-row">
                  <span className="result-code">{p.qr_code}</span>
                  <span className="result-meta">{[p.batch, p.size, p.colour].filter(Boolean).join(' · ') || '—'}</span>
                  <span className="badge badge-registered">In stock</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
