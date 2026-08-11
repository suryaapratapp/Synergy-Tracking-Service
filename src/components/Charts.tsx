import { useId, useState } from 'react'
import { useMeasure } from '../hooks/useMeasure'

/*
 * Hand-built SVG charts.
 *
 * Colours come from validated palette slots declared in styles.css; the two
 * lowest-contrast slots always carry a visible label or a legend value, which
 * is the relief the palette check requires.
 */

export interface Slice {
  label: string
  value: number
  /** CSS custom property name, e.g. "--series-1". */
  token: string
}

/* ------------------------------------------------------------------ donut */

export function DonutChart({ data, centreLabel }: { data: Slice[]; centreLabel?: string }) {
  const { ref, width } = useMeasure<HTMLDivElement>()
  const [active, setActive] = useState<number | null>(null)
  const total = data.reduce((s, d) => s + d.value, 0)

  const size = Math.max(180, Math.min(width || 260, 260))
  const r = size / 2
  const stroke = Math.round(size * 0.17)
  const radius = r - stroke / 2 - 2
  const circumference = 2 * Math.PI * radius
  // 2px of surface between segments, as the mark spec requires.
  const gap = total > 0 && data.filter((d) => d.value > 0).length > 1 ? 2 : 0

  let offset = 0

  return (
    <div className="chart chart-donut" ref={ref}>
      <div className="donut-wrap" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img"
             aria-label={`Breakdown: ${data.map((d) => `${d.label} ${d.value}`).join(', ')}`}>
          <circle cx={r} cy={r} r={radius} fill="none" stroke="var(--grid)" strokeWidth={stroke} />
          {total > 0 &&
            data.map((d, i) => {
              if (d.value <= 0) return null
              const len = (d.value / total) * circumference
              const dash = Math.max(len - gap, 1)
              const el = (
                <circle
                  key={d.label}
                  cx={r}
                  cy={r}
                  r={radius}
                  fill="none"
                  stroke={`var(${d.token})`}
                  strokeWidth={active === i ? stroke + 4 : stroke}
                  strokeDasharray={`${dash} ${circumference - dash}`}
                  strokeDashoffset={-offset}
                  transform={`rotate(-90 ${r} ${r})`}
                  style={{ transition: 'stroke-width .15s ease' }}
                  onPointerEnter={() => setActive(i)}
                  onPointerLeave={() => setActive(null)}
                >
                  <title>{`${d.label}: ${d.value} (${Math.round((d.value / total) * 100)}%)`}</title>
                </circle>
              )
              offset += len
              return el
            })}
        </svg>
        <div className="donut-centre">
          <strong>{active !== null ? data[active].value : total}</strong>
          <span>{active !== null ? data[active].label : centreLabel ?? 'Total'}</span>
        </div>
      </div>

      <ul className="legend">
        {data.map((d, i) => (
          <li
            key={d.label}
            className={active === i ? 'is-active' : ''}
            onPointerEnter={() => setActive(i)}
            onPointerLeave={() => setActive(null)}
          >
            <span className="legend-swatch" style={{ background: `var(${d.token})` }} aria-hidden="true" />
            <span className="legend-label">{d.label}</span>
            <span className="legend-value">
              {d.value}
              <small>{total > 0 ? ` · ${Math.round((d.value / total) * 100)}%` : ''}</small>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* -------------------------------------------------------------- bar chart */

export interface BarDatum {
  label: string
  sublabel?: string
  values: { value: number; token: string; name: string }[]
}

/** Horizontal bars - the reliable choice on a phone, where labels need room. */
export function BarChart({ data, showLegend = true }: { data: BarDatum[]; showLegend?: boolean }) {
  const max = Math.max(1, ...data.flatMap((d) => d.values.map((v) => v.value)))
  const series = data[0]?.values ?? []

  return (
    <div className="chart chart-bars">
      {showLegend && series.length > 1 && (
        <ul className="legend legend-inline">
          {series.map((s) => (
            <li key={s.name}>
              <span className="legend-swatch" style={{ background: `var(${s.token})` }} aria-hidden="true" />
              <span className="legend-label">{s.name}</span>
            </li>
          ))}
        </ul>
      )}

      <ul className="bar-list">
        {data.map((d) => (
          <li key={d.label} className="bar-row">
            <div className="bar-head">
              <span className="bar-label">
                {d.label}
                {d.sublabel && <small>{d.sublabel}</small>}
              </span>
              <span className="bar-values">
                {d.values.map((v) => (
                  <span key={v.name} className="bar-value" style={{ color: `var(${v.token})` }}>
                    {v.value}
                  </span>
                ))}
              </span>
            </div>
            <div className="bar-track">
              {d.values.map((v) => (
                <div key={v.name} className="bar-seg" title={`${v.name}: ${v.value}`}>
                  <div
                    className="bar-fill"
                    style={{
                      width: `${(v.value / max) * 100}%`,
                      background: `var(${v.token})`,
                    }}
                  />
                </div>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ------------------------------------------------------------- line chart */

export interface LineSeries {
  name: string
  token: string
  points: number[]
}

export function LineChart({
  labels,
  series,
  height = 200,
}: {
  labels: string[]
  series: LineSeries[]
  height?: number
}) {
  const { ref, width } = useMeasure<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const clipId = useId()

  const w = Math.max(280, width || 320)
  const pad = { top: 14, right: 12, bottom: 26, left: 32 }
  const plotW = w - pad.left - pad.right
  const plotH = height - pad.top - pad.bottom

  const max = Math.max(1, ...series.flatMap((s) => s.points))
  const niceMax = niceCeiling(max)
  const n = labels.length
  const x = (i: number) => pad.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW)
  const y = (v: number) => pad.top + plotH - (v / niceMax) * plotH

  const ticks = [0, niceMax / 2, niceMax]

  return (
    <div className="chart chart-line" ref={ref}>
      <ul className="legend legend-inline">
        {series.map((s) => (
          <li key={s.name}>
            <span className="legend-swatch" style={{ background: `var(${s.token})` }} aria-hidden="true" />
            <span className="legend-label">{s.name}</span>
          </li>
        ))}
      </ul>

      <svg
        width={w}
        height={height}
        role="img"
        aria-label={`Monthly trend: ${series.map((s) => s.name).join(' and ')}`}
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          const px = e.clientX - rect.left
          const i = Math.round(((px - pad.left) / plotW) * (n - 1))
          setHover(i >= 0 && i < n ? i : null)
        }}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={pad.left} y={pad.top - 4} width={plotW} height={plotH + 8} />
          </clipPath>
        </defs>

        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={w - pad.right} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth="1" />
            <text x={pad.left - 6} y={y(t) + 4} textAnchor="end" className="axis-text">
              {Math.round(t)}
            </text>
          </g>
        ))}

        {labels.map((l, i) =>
          i % Math.ceil(n / 6) === 0 || i === n - 1 ? (
            <text key={`${l}-${i}`} x={x(i)} y={height - 8} textAnchor="middle" className="axis-text">
              {l}
            </text>
          ) : null,
        )}

        {hover !== null && (
          <line
            x1={x(hover)}
            x2={x(hover)}
            y1={pad.top}
            y2={pad.top + plotH}
            stroke="var(--axis)"
            strokeWidth="1"
            strokeDasharray="3 3"
          />
        )}

        <g clipPath={`url(#${clipId})`}>
          {series.map((s) => (
            <polyline
              key={s.name}
              points={s.points.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
              fill="none"
              stroke={`var(${s.token})`}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          {hover !== null &&
            series.map((s) => (
              <circle
                key={s.name}
                cx={x(hover)}
                cy={y(s.points[hover] ?? 0)}
                r="4.5"
                fill={`var(${s.token})`}
                stroke="var(--surface)"
                strokeWidth="2"
              />
            ))}
        </g>
      </svg>

      <div className={`chart-tooltip ${hover !== null ? 'is-open' : ''}`} aria-live="polite">
        {hover !== null && (
          <>
            <strong>{labels[hover]}</strong>
            {series.map((s) => (
              <span key={s.name}>
                <span className="legend-swatch" style={{ background: `var(${s.token})` }} aria-hidden="true" />
                {s.name}: <b>{s.points[hover] ?? 0}</b>
              </span>
            ))}
          </>
        )}
      </div>
    </div>
  )
}

function niceCeiling(v: number): number {
  if (v <= 5) return 5
  const mag = 10 ** Math.floor(Math.log10(v))
  return Math.ceil(v / (mag / 2)) * (mag / 2)
}

/* ------------------------------------------------------------- stat tiles */

export function StatTile({
  label,
  value,
  hint,
  tone = 'neutral',
  onClick,
}: {
  label: string
  value: string | number
  hint?: string
  tone?: 'neutral' | 'good' | 'warning' | 'critical' | 'accent'
  onClick?: () => void
}) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag className={`stat stat-${tone}`} onClick={onClick} type={onClick ? 'button' : undefined}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
      {hint && <span className="stat-hint">{hint}</span>}
    </Tag>
  )
}
