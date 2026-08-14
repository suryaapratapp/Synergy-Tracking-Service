import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, friendlyError } from '../lib/supabase'
import { Card, EmptyState, Field, SectionTitle, Spinner, useToast } from '../components/ui'
import QrLabel from '../components/QrLabel'
import {
  DEFAULT_PRODUCT_CODE,
  codePrefixFor,
  normaliseProductCode,
  qrSvg,
  qrSvgMany,
  responsiveSvg,
  sampleCode,
} from '../lib/qr'
import { downloadCsv, toCsv } from '../lib/csv'
import { formatDate } from '../lib/format'
import type { ProductView } from '../lib/types'

const PREVIEW_LIMIT = 24
const QUANTITIES = [10, 50, 100, 250, 500]

/**
 * Admin-only label generation. The database mints and reserves each code, so
 * a number can never be printed twice while a product still holds it.
 */
export default function LabelsPage() {
  const toast = useToast()

  const [productCode, setProductCode] = useState(DEFAULT_PRODUCT_CODE)
  const [productType, setProductType] = useState('Curtain')
  const [count, setCount] = useState(500)
  const [batch, setBatch] = useState('')
  const [size, setSize] = useState('')
  const [colour, setColour] = useState('')

  const [busy, setBusy] = useState(false)
  const [generated, setGenerated] = useState<ProductView[]>([])
  const [svgs, setSvgs] = useState<Map<string, string>>(new Map())
  const [sampleSvg, setSampleSvg] = useState<string>('')
  const [printing, setPrinting] = useState(false)
  const [recent, setRecent] = useState<{ batch: string | null; n: number; at: string }[]>([])

  const prefix = useMemo(() => codePrefixFor(productCode), [productCode])

  // Keep the format preview in step with whatever product code is typed.
  useEffect(() => {
    let cancelled = false
    void qrSvg(sampleCode(productCode)).then((s) => {
      if (!cancelled) setSampleSvg(responsiveSvg(s))
    })
    return () => {
      cancelled = true
    }
  }, [productCode])

  const loadRecent = useCallback(async () => {
    const { data } = await supabase
      .from('products')
      .select('batch, registered_at')
      .not('batch', 'is', null)
      .order('registered_at', { ascending: false })
      .limit(400)
    const groups = new Map<string, { n: number; at: string }>()
    for (const row of (data ?? []) as { batch: string; registered_at: string }[]) {
      const g = groups.get(row.batch)
      if (g) g.n += 1
      else groups.set(row.batch, { n: 1, at: row.registered_at })
    }
    setRecent([...groups.entries()].map(([b, g]) => ({ batch: b, ...g })).slice(0, 6))
  }, [])

  useEffect(() => {
    void loadRecent()
  }, [loadRecent])

  const generate = async () => {
    if (busy) return
    setBusy(true)
    setGenerated([])
    setSvgs(new Map())

    const { data, error } = await supabase.rpc('rpc_generate_product_codes', {
      p_product_code: normaliseProductCode(productCode) || DEFAULT_PRODUCT_CODE,
      p_product_type: productType.trim() || 'Curtain',
      p_count: count,
      p_batch: batch.trim() || null,
      p_size: size.trim() || null,
      p_colour: colour.trim() || null,
    })

    if (error) {
      toast('error', friendlyError(error))
      setBusy(false)
      return
    }

    const rows = (data ?? []) as ProductView[]
    setGenerated(rows)
    setSvgs(await qrSvgMany(rows.slice(0, PREVIEW_LIMIT).map((r) => r.qr_code)))
    toast('success', `${rows.length} label${rows.length === 1 ? '' : 's'} generated`)
    setBusy(false)
    void loadRecent()
  }

  const exportCsv = () => {
    const csv = toCsv(
      ['Code', 'Product code', 'Product', 'Batch', 'Size', 'Colour', 'Generated'],
      generated.map((p) => [
        p.qr_code,
        p.product_code,
        p.product_type,
        p.batch,
        p.size,
        p.colour,
        formatDate(p.registered_at),
      ]),
    )
    downloadCsv(`labels-${prefix.replace(/-$/, '')}-${new Date().toISOString().slice(0, 10)}.csv`, csv)
    toast('success', `${generated.length} codes exported`)
  }

  /**
   * Prints in a separate document so the label sheet is not fighting the app's
   * own stylesheet, and so the browser's page setup applies cleanly.
   */
  const printSheet = async () => {
    if (printing) return
    setPrinting(true)
    try {
      const all = await qrSvgMany(generated.map((g) => g.qr_code))
      const win = window.open('', '_blank')
      if (!win) {
        toast('error', 'Allow pop-ups for this site to print the label sheet.')
        return
      }
      const cells = generated
        .map(
          (g) => `<figure class="l"><div class="q">${all.get(g.qr_code) ?? ''}</div><figcaption>${g.qr_code}</figcaption></figure>`,
        )
        .join('')

      win.document.write(`<!doctype html><html><head><meta charset="utf-8">
<title>Labels ${prefix.replace(/-$/, '')}</title>
<style>
  @page { size: A4; margin: 8mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
  .sheet { display: grid; grid-template-columns: repeat(auto-fill, 28mm); gap: 4mm; }
  .l { width: 28mm; height: 34mm; margin: 0; padding: 1.5mm;
       border: 0.3mm solid #bbb; border-radius: 1.5mm;
       display: flex; flex-direction: column; align-items: center; justify-content: flex-start;
       page-break-inside: avoid; break-inside: avoid; }
  .q { width: 24mm; height: 24mm; }
  .q svg { display: block; width: 100%; height: 100%; }
  figcaption { margin-top: 1mm; font-size: 5.4pt; letter-spacing: 0.02em;
               font-variant-numeric: tabular-nums; text-align: center; white-space: nowrap; }
  @media screen { body { padding: 12mm; background: #f4f7f7; } .sheet { background: #fff; padding: 8mm; } }
</style></head><body><div class="sheet">${cells}</div>
<script>window.onload=function(){setTimeout(function(){window.print()},250)}<\/script>
</body></html>`)
      win.document.close()
    } finally {
      setPrinting(false)
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>QR labels</h1>
          <p className="page-sub">Generate and print label codes</p>
        </div>
      </div>

      <Card className="step-card step-1">
        <SectionTitle>
          <span className="step-num">1</span> What are you labelling?
        </SectionTitle>

        <div className="form-grid">
          <Field
            label="Product code"
            htmlFor="lbl-code"
            hint="The middle block of the code. Letters and digits only."
          >
            <input
              id="lbl-code"
              className="input"
              value={productCode}
              onChange={(e) => setProductCode(e.target.value.toUpperCase())}
              placeholder={DEFAULT_PRODUCT_CODE}
              maxLength={10}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="off"
            />
          </Field>

          <Field label="Product name" htmlFor="lbl-type" hint="For reporting; not part of the code.">
            <input
              id="lbl-type"
              className="input"
              value={productType}
              onChange={(e) => setProductType(e.target.value)}
              placeholder="Curtain"
              autoComplete="off"
            />
          </Field>

          <Field label="How many labels?" htmlFor="lbl-count">
            <input
              id="lbl-count"
              className="input"
              type="number"
              min={1}
              max={500}
              inputMode="numeric"
              value={count}
              onChange={(e) => setCount(Math.max(1, Math.min(500, Number(e.target.value) || 1)))}
            />
          </Field>
        </div>

        <div className="chip-row">
          {QUANTITIES.map((q) => (
            <button
              key={q}
              type="button"
              className={`chip ${count === q ? 'is-active' : ''}`}
              onClick={() => setCount(q)}
            >
              {q}
            </button>
          ))}
        </div>

        <details className="details">
          <summary>Optional details for this run</summary>
          <div className="form-grid">
            <Field label="Batch reference" htmlFor="lbl-batch">
              <input
                id="lbl-batch"
                className="input"
                value={batch}
                onChange={(e) => setBatch(e.target.value)}
                placeholder="e.g. B-2026-08"
                autoComplete="off"
              />
            </Field>
            <Field label="Size" htmlFor="lbl-size">
              <input
                id="lbl-size"
                className="input"
                value={size}
                onChange={(e) => setSize(e.target.value)}
                placeholder="e.g. 3000 x 2000"
                autoComplete="off"
              />
            </Field>
            <Field label="Colour" htmlFor="lbl-colour">
              <input
                id="lbl-colour"
                className="input"
                value={colour}
                onChange={(e) => setColour(e.target.value)}
                placeholder="e.g. Sky Blue"
                autoComplete="off"
              />
            </Field>
          </div>
        </details>
      </Card>

      <Card className="step-card step-2">
        <SectionTitle>
          <span className="step-num">2</span> Check the format
        </SectionTitle>
        <div className="label-preview">
          <QrLabel code={sampleCode(productCode)} svg={sampleSvg} />
          <div className="label-preview-note">
            <p>
              Codes look like <code>{prefix}AAAA0001</code> — a fixed <strong>RZCIR</strong> prefix,
              the product code, then four letters and four digits.
            </p>
            <p className="muted">
              Codes are issued in ascending serial order and reserved as they are generated. A number
              is never issued twice, whatever happens to the product afterwards.
            </p>
          </div>
        </div>

        <button
          type="button"
          className="btn btn-primary btn-lg btn-block"
          onClick={() => void generate()}
          disabled={busy || normaliseProductCode(productCode).length < 2}
        >
          {busy ? 'Generating…' : `Generate ${count} label${count === 1 ? '' : 's'}`}
        </button>
      </Card>

      <Card className="step-card step-3">
        <SectionTitle
          action={
            generated.length > 0 ? (
              <span className="muted">{generated.length} ready</span>
            ) : undefined
          }
        >
          <span className="step-num">3</span> Print or export
        </SectionTitle>

        {busy ? (
          <Spinner label="Generating labels" />
        ) : generated.length === 0 ? (
          <EmptyState
            title="No labels generated yet"
            hint="Generated codes appear here, ready to download or print."
          />
        ) : (
          <>
            <div className="import-actions">
              <button type="button" className="btn btn-primary" onClick={exportCsv}>
                Download CSV
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => void printSheet()}
                disabled={printing}
              >
                {printing ? 'Preparing…' : 'Print label sheet'}
              </button>
            </div>

            <div className="qr-grid">
              {generated.slice(0, PREVIEW_LIMIT).map((p) => (
                <QrLabel key={p.id} code={p.qr_code} svg={svgs.get(p.qr_code)} size="sm" />
              ))}
            </div>
            {generated.length > PREVIEW_LIMIT && (
              <p className="table-note">
                Showing the first {PREVIEW_LIMIT} of {generated.length}. The CSV and the print sheet
                contain all of them.
              </p>
            )}
          </>
        )}
      </Card>

      {recent.length > 0 && (
        <Card>
          <SectionTitle>Recent batches</SectionTitle>
          <ul className="kv-list">
            {recent.map((r) => (
              <li key={r.batch}>
                <span>{r.batch}</span>
                <strong>
                  {r.n} · {formatDate(r.at)}
                </strong>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
