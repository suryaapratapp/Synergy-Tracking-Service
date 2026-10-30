import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase, friendlyError } from '../lib/supabase'
import { Card, EmptyState, Field, SectionTitle, Spinner, useToast } from '../components/ui'
import QrLabel from '../components/QrLabel'
import {
  DEFAULT_CODE_FORMAT,
  DEFAULT_PRODUCT_CODE,
  MAX_DIGITS,
  MAX_LETTERS,
  codeCapacity,
  codePrefixFor,
  isValidPrefix,
  normaliseProductCode,
  normalisePrefix,
  qrSvg,
  qrSvgMany,
  responsiveSvg,
  sampleCode,
  serialSample,
  type CodeFormat,
} from '../lib/qr'
import { downloadCsv, toCsv } from '../lib/csv'
import { formatDate } from '../lib/format'
import type { ProductView } from '../lib/types'

/** A code that exists only as a code (not a product), shaped like a product row so export and print can treat both alike. */
function codeOnlyRow(code: string, productCode: string, productType: string, batch: string | null): ProductView {
  return {
    id: code,
    qr_code: code,
    product_code: productCode,
    product_type: productType,
    batch,
    size: null,
    colour: null,
    registered_at: new Date().toISOString(),
  } as unknown as ProductView
}

const PREVIEW_LIMIT = 24
/** The most labels one run can ask for. */
const MAX_LABELS = 50_000
const QUANTITIES = [100, 500, 1000, 5000, 10_000, MAX_LABELS]
/** The database makes at most this many per request (a response carries 1,000 rows), so a big run is made in steps. */
const STEP = 1000
/** Labels per printed sheet run: a browser cannot lay out tens of thousands of QR codes at once. */
const SHEET = 500
/** Ask before a run this large - the numbers are used up for good. */
const CONFIRM_FROM = 5000

/**
 * Admin-only label generation. The database mints and reserves each code, so
 * a number can never be printed twice while a product still holds it.
 */
export default function LabelsPage() {
  const toast = useToast()

  const [productCode, setProductCode] = useState(DEFAULT_PRODUCT_CODE)
  const [productType, setProductType] = useState('Curtain')
  const [count, setCount] = useState(500)
  const [progress, setProgress] = useState<{ done: number; total: number; kind: 'generate' | 'load' } | null>(null)
  const stopRef = useRef(false)
  const [sheet, setSheet] = useState(0)
  const [loadedBatch, setLoadedBatch] = useState<string | null>(null)
  /** Chosen on purpose every time - null until the person says. Making codes for use elsewhere must not register them by accident. */
  const [registerMode, setRegisterMode] = useState<'yes' | 'no' | null>(null)
  const [loadedRegistered, setLoadedRegistered] = useState(true)
  const [batch, setBatch] = useState('')
  const [size, setSize] = useState('')
  const [colour, setColour] = useState('')

  const [busy, setBusy] = useState(false)
  const [generated, setGenerated] = useState<ProductView[]>([])
  const [svgs, setSvgs] = useState<Map<string, string>>(new Map())
  const [sampleSvg, setSampleSvg] = useState<string>('')
  const [printing, setPrinting] = useState(false)
  const [recent, setRecent] = useState<{ batch: string; n: number; at: string; registered: boolean }[]>([])

  const [saved, setSaved] = useState<CodeFormat>(DEFAULT_CODE_FORMAT)
  const [draft, setDraft] = useState<CodeFormat>(DEFAULT_CODE_FORMAT)
  const prefix = useMemo(() => codePrefixFor(productCode, draft.prefix), [productCode, draft.prefix])

  // The code format: what is saved (above), and what is being edited on this screen.
  const [savingFormat, setSavingFormat] = useState(false)
  const dirty =
    draft.prefix !== saved.prefix || draft.letters !== saved.letters || draft.digits !== saved.digits
  const capacity = codeCapacity(draft)
  const tooSmall = capacity < 10000n
  const prefixBad = !isValidPrefix(draft.prefix)

  useEffect(() => {
    void supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'code_format')
      .maybeSingle()
      .then(({ data }) => {
        const v = data?.value as Partial<CodeFormat> | undefined
        if (v?.letters && v?.digits) {
          const f = { prefix: v.prefix || DEFAULT_CODE_FORMAT.prefix, letters: v.letters, digits: v.digits }
          setSaved(f)
          setDraft(f)
        }
      })
  }, [])

  const saveFormat = async () => {
    if (!dirty || tooSmall || prefixBad || savingFormat) return
    setSavingFormat(true)
    const { error } = await supabase.rpc('admin_set_code_format', {
      p_prefix: draft.prefix,
      p_letters: draft.letters,
      p_digits: draft.digits,
    })
    setSavingFormat(false)
    if (error) {
      toast('error', friendlyError(error))
      return
    }
    setSaved(draft)
    toast('success', `Code format saved — new labels look like ${sampleCode(productCode, draft)}`)
  }

  // Keep the format preview in step with whatever product code is typed.
  useEffect(() => {
    let cancelled = false
    void qrSvg(sampleCode(productCode, draft)).then((s) => {
      if (!cancelled) setSampleSvg(responsiveSvg(s))
    })
    return () => {
      cancelled = true
    }
  }, [productCode, draft])

  const loadRecent = useCallback(async () => {
    const { data } = await supabase.rpc('rpc_label_batches', { p_limit: 8 })
    setRecent(
      ((data ?? []) as { batch: string; n: number; at: string; registered: boolean }[]).map((r) => ({
        batch: r.batch,
        n: Number(r.n),
        at: r.at,
        registered: r.registered,
      })),
    )
  }, [])

  useEffect(() => {
    void loadRecent()
  }, [loadRecent])

  const generate = async () => {
    if (busy || !registerMode) return
    const register = registerMode === 'yes'
    const n = count.toLocaleString('en-GB')
    const ok = register
      ? count < CONFIRM_FROM ||
        window.confirm(`Generate and register ${n} labels? Their numbers are used up for good, even if you do not print them all.`)
      : window.confirm(
          `Make ${n} codes WITHOUT registering them?\n\nFitters will not be able to install them in Tex-Trak until they are registered. The numbers are still reserved, so they are never used again.`,
        )
    if (!ok) return

    // A code-only run needs a name so it can be found again - the codes are not stored as products.
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
    const batchName = batch.trim() || (register ? null : `codes ${stamp}`)

    setBusy(true)
    stopRef.current = false
    setGenerated([])
    setSvgs(new Map())
    setSheet(0)
    setLoadedBatch(null)
    setLoadedRegistered(register)
    setProgress({ done: 0, total: count, kind: 'generate' })

    // Made in steps: each request is quick, and nothing is ever issued twice
    // because every step takes its numbers from the database counter.
    const rows: ProductView[] = []
    let failure: string | null = null
    while (rows.length < count && !stopRef.current) {
      const step = Math.min(STEP, count - rows.length)
      const base = {
        p_product_code: normaliseProductCode(productCode) || DEFAULT_PRODUCT_CODE,
        p_product_type: productType.trim() || 'Curtain',
        p_count: step,
        p_batch: batchName,
      }
      if (register) {
        const { data, error } = await supabase.rpc('rpc_generate_product_codes', {
          ...base,
          p_size: size.trim() || null,
          p_colour: colour.trim() || null,
        })
        if (error) {
          failure = friendlyError(error)
          break
        }
        rows.push(...((data ?? []) as ProductView[]))
      } else {
        const { data, error } = await supabase.rpc('rpc_reserve_codes', base)
        if (error) {
          failure = friendlyError(error)
          break
        }
        rows.push(...((data ?? []) as { qr_code: string }[]).map((r) => codeOnlyRow(r.qr_code, base.p_product_code, base.p_product_type, batchName)))
      }
      setProgress({ done: rows.length, total: count, kind: 'generate' })
    }

    setGenerated(rows)
    setSvgs(await qrSvgMany(rows.slice(0, PREVIEW_LIMIT).map((r) => r.qr_code)))
    setProgress(null)
    setBusy(false)
    if (!register && batchName) setLoadedBatch(batchName)

    const made = `${rows.length.toLocaleString('en-GB')} ${register ? 'label' : 'code'}${rows.length === 1 ? '' : 's'}`
    if (failure) {
      toast('error', `Stopped after ${made}: ${failure}`)
    } else if (rows.length < count) {
      toast('info', `Stopped after ${made}. Those are saved and ready below.`)
    } else {
      toast('success', register ? `${made} generated and registered` : `${made} made — not registered`)
    }
    void loadRecent()
  }

  /**
   * Reload an earlier run so it can be exported or printed again. Reads in code
   * order, each page starting where the last ended - skipping ahead by offset
   * gets slower with every page and would take minutes for a big run.
   */
  const loadBatch = async (name: string, total: number, registered: boolean) => {
    if (busy) return
    setBusy(true)
    setGenerated([])
    setSvgs(new Map())
    setSheet(0)
    setLoadedRegistered(registered)
    setProgress({ done: 0, total, kind: 'load' })

    const rows: ProductView[] = []
    let after = ''
    let offset = 0
    let failure: string | null = null
    for (;;) {
      let page: ProductView[]
      if (registered) {
        let q = supabase
          .from('products')
          .select('id,qr_code,product_code,product_type,batch,size,colour,registered_at')
          .eq('batch', name)
          .order('qr_code')
          .limit(STEP)
        if (after) q = q.gt('qr_code', after)
        const { data, error } = await q
        if (error) {
          failure = friendlyError(error)
          break
        }
        page = (data ?? []) as ProductView[]
        if (page.length) after = page[page.length - 1].qr_code
      } else {
        const { data, error } = await supabase.rpc('rpc_label_run_codes', { p_batch: name, p_offset: offset, p_limit: STEP })
        if (error) {
          failure = friendlyError(error)
          break
        }
        page = ((data ?? []) as { qr_code: string }[]).map((r) => codeOnlyRow(r.qr_code, '', 'Curtain', name))
        offset += page.length
      }
      rows.push(...page)
      setProgress({ done: rows.length, total, kind: 'load' })
      if (page.length < STEP) break
    }

    if (failure) toast('error', failure)
    setGenerated(rows)
    setSvgs(await qrSvgMany(rows.slice(0, PREVIEW_LIMIT).map((r) => r.qr_code)))
    setLoadedBatch(name)
    setProgress(null)
    setBusy(false)
  }

  /** Register a batch that was made as codes only. One run at a time, so each call is quick. */
  const registerBatch = async (name: string) => {
    if (busy) return
    if (!window.confirm(`Register "${name}" now? Fitters will then be able to install these labels.`)) return
    setBusy(true)
    let failure: string | null = null
    for (let guard = 0; guard < 200; guard++) {
      const { data, error } = await supabase.rpc('rpc_register_label_batch', { p_batch: name })
      if (error) {
        failure = friendlyError(error)
        break
      }
      if (Number(data) === 0) break
    }
    setBusy(false)
    if (failure) toast('error', failure)
    else {
      toast('success', `"${name}" is registered`)
      setLoadedRegistered(true)
    }
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
    toast('success', `${generated.length.toLocaleString('en-GB')} codes exported`)
  }

  /**
   * Prints in a separate document so the label sheet is not fighting the app's
   * own stylesheet, and so the browser's page setup applies cleanly.
   */
  const printSheet = async () => {
    if (printing) return
    setPrinting(true)
    try {
      const pageRows = generated.slice(sheet * SHEET, (sheet + 1) * SHEET)
      const all = await qrSvgMany(pageRows.map((g) => g.qr_code))
      const win = window.open('', '_blank')
      if (!win) {
        toast('error', 'Allow pop-ups for this site to print the label sheet.')
        return
      }
      // 5.4pt fits a 21-character code under a 24 mm QR; shrink for anything longer.
      const longest = Math.max(...pageRows.map((g) => g.qr_code.length))
      const captionPt = Math.min(5.4, (5.4 * 21) / longest).toFixed(2)
      const cells = pageRows
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
  figcaption { margin-top: 1mm; font-size: ${captionPt}pt; letter-spacing: 0.02em;
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

          <Field
            label="How many labels?"
            htmlFor="lbl-count"
            hint={`Up to ${MAX_LABELS.toLocaleString('en-GB')} in one run. Each number is issued once, ever.`}
          >
            <input
              id="lbl-count"
              className="input"
              type="number"
              min={1}
              max={MAX_LABELS}
              inputMode="numeric"
              value={count}
              onChange={(e) => setCount(Math.max(1, Math.min(MAX_LABELS, Number(e.target.value) || 1)))}
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
              {q.toLocaleString('en-GB')}
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
          <QrLabel code={sampleCode(productCode, draft)} svg={sampleSvg} />
          <div className="label-preview-note">
            <p>
              Codes look like <code>{sampleCode(productCode, draft)}</code> — the prefix{' '}
              <strong>{draft.prefix || '…'}</strong>, the product code, then {draft.letters} letter
              {draft.letters === 1 ? '' : 's'} and {draft.digits} digit{draft.digits === 1 ? '' : 's'}.
            </p>
            <p className="muted">
              Codes are issued in ascending serial order and reserved as they are generated. A number
              is never issued twice, whatever happens to the product afterwards.
            </p>
          </div>
        </div>

        <div className="format-edit">
          <h3>Code format</h3>
          <div className="form-grid">
            <Field label="Prefix" htmlFor="fmt-prefix" hint="3–10 letters or digits at the start of every code.">
              <input
                id="fmt-prefix"
                className="input"
                value={draft.prefix}
                onChange={(e) => setDraft({ ...draft, prefix: normalisePrefix(e.target.value) })}
                maxLength={10}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="off"
              />
            </Field>
            <Field label="Letters" htmlFor="fmt-letters">
              <select
                id="fmt-letters"
                className="input"
                value={draft.letters}
                onChange={(e) => setDraft({ ...draft, letters: Number(e.target.value) })}
              >
                {Array.from({ length: MAX_LETTERS }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Digits" htmlFor="fmt-digits">
              <select
                id="fmt-digits"
                className="input"
                value={draft.digits}
                onChange={(e) => setDraft({ ...draft, digits: Number(e.target.value) })}
              >
                {Array.from({ length: MAX_DIGITS }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <p className={tooSmall || prefixBad ? 'form-error' : 'muted'}>
            {prefixBad
              ? 'The prefix must be 3 to 10 letters or digits.'
              : tooSmall
                ? `Only ${capacity.toLocaleString('en-GB')} codes per product — choose a longer format.`
                : `Room for ${capacity.toLocaleString('en-GB')} codes per product.`}
          </p>
          <p className="muted">
            A new prefix or format applies to labels generated from now on. Labels already printed keep working
            — every earlier prefix is still accepted. Each prefix and format counts up from{' '}
            {serialSample(draft)} on its own, so no code is ever issued twice.
          </p>
          <button
            type="button"
            className="btn btn-ghost btn-block"
            onClick={() => void saveFormat()}
            disabled={!dirty || tooSmall || prefixBad || savingFormat}
          >
            {savingFormat ? 'Saving…' : dirty ? 'Save this format' : 'Format is saved'}
          </button>
        </div>

        {progress ? (
          <div className="gen-progress" role="status">
            <div className="gen-bar">
              <span style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
            </div>
            <p>
              {progress.kind === 'generate' ? 'Generating…' : 'Loading…'}{' '}
              <strong>{progress.done.toLocaleString('en-GB')}</strong> of {progress.total.toLocaleString('en-GB')}.
              Keep this screen open.
            </p>
            {progress.kind === 'generate' && (
              <button type="button" className="btn btn-ghost btn-block" onClick={() => (stopRef.current = true)}>
                Stop after this step
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="choice-group" role="radiogroup" aria-label="Register these labels?">
              <p className="choice-q">
                Register these labels in Tex-Trak? <span className="req">*</span>
              </p>
              <button
                type="button"
                role="radio"
                aria-checked={registerMode === 'yes'}
                className={`choice ${registerMode === 'yes' ? 'is-on' : ''}`}
                onClick={() => setRegisterMode('yes')}
              >
                <strong>Yes, register them</strong>
                <small>Fitters can install and track them</small>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={registerMode === 'no'}
                className={`choice ${registerMode === 'no' ? 'is-on is-no' : ''}`}
                onClick={() => setRegisterMode('no')}
              >
                <strong>No, just make the codes</strong>
                <small>For printing elsewhere. Numbers are reserved, nothing is registered</small>
              </button>
            </div>
            <button
              type="button"
              className="btn btn-primary btn-lg btn-block"
              onClick={() => void generate()}
              disabled={busy || dirty || prefixBad || !registerMode || normaliseProductCode(productCode).length < 2}
            >
              {dirty
                ? 'Save the new format first'
                : !registerMode
                  ? 'Choose yes or no above'
                  : `${registerMode === 'yes' ? 'Generate' : 'Make'} ${count.toLocaleString('en-GB')} ${registerMode === 'yes' ? 'label' : 'code'}${count === 1 ? '' : 's'}`}
            </button>
          </>
        )}
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

        {busy && !progress ? (
          <Spinner label="Loading labels" />
        ) : busy ? (
          <p className="muted">Working…</p>
        ) : generated.length === 0 ? (
          <EmptyState
            title="No labels generated yet"
            hint="Generated codes appear here, ready to download or print."
          />
        ) : (
          <>
            {!loadedRegistered && (
              <div className="unreg-note" role="status">
                <strong>Not registered.</strong> These are codes only; fitters cannot install them in Tex-Trak.
                {loadedBatch && (
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => void registerBatch(loadedBatch)} disabled={busy}>
                    Register them now
                  </button>
                )}
              </div>
            )}
            {loadedBatch && (
              <p className="table-note">
                Batch <strong>{loadedBatch}</strong> · {generated.length.toLocaleString('en-GB')} {loadedRegistered ? 'labels' : 'codes'}
              </p>
            )}
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
                {printing ? 'Preparing…' : generated.length > SHEET ? 'Print this sheet' : 'Print label sheet'}
              </button>
            </div>

            {generated.length > SHEET && (
              <div className="field">
                <label className="field-label" htmlFor="lbl-sheet">
                  Sheet to print
                </label>
                <select
                  id="lbl-sheet"
                  className="input"
                  value={sheet}
                  onChange={(e) => setSheet(Number(e.target.value))}
                >
                  {Array.from({ length: Math.ceil(generated.length / SHEET) }, (_, i) => (
                    <option key={i} value={i}>
                      Sheet {i + 1} of {Math.ceil(generated.length / SHEET)} — labels{' '}
                      {(i * SHEET + 1).toLocaleString('en-GB')}–
                      {Math.min((i + 1) * SHEET, generated.length).toLocaleString('en-GB')}
                    </option>
                  ))}
                </select>
                <p className="field-hint">
                  Large runs print {SHEET} labels at a time. For thousands of labels, download the CSV for the
                  label printer instead.
                </p>
              </div>
            )}

            <div className="qr-grid">
              {generated.slice(0, PREVIEW_LIMIT).map((p) => (
                <QrLabel key={p.id} code={p.qr_code} svg={svgs.get(p.qr_code)} size="sm" />
              ))}
            </div>
            {generated.length > PREVIEW_LIMIT && (
              <p className="table-note">
                Showing the first {PREVIEW_LIMIT} of {generated.length.toLocaleString('en-GB')}. The CSV
                contains all of them.
              </p>
            )}
          </>
        )}
      </Card>

      {recent.length > 0 && (
        <Card>
          <SectionTitle>Recent batches (tap one to export or print it again)</SectionTitle>
          <ul className="kv-list">
            {recent.map((r) => (
              <li key={r.batch}>
                <button type="button" className="link-button" onClick={() => void loadBatch(r.batch, r.n, r.registered)} disabled={busy}>
                  {r.batch}
                  {!r.registered && <span className="badge badge-queued unreg-badge">Not registered</span>}
                </button>
                <strong>
                  {r.n.toLocaleString('en-GB')} · {formatDate(r.at)}
                </strong>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
