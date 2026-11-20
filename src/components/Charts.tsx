import { useState } from 'react'

/** Diverging bars per hole around a baseline: above the line costs strokes (red), below saves them (green). Scrub with a finger to read any hole. */
export function HoleBars({ values, labels, readout, baseline = 0, title }: { values: (number | null)[]; labels: string[]; readout: (i: number) => string; baseline?: number; title: string }) {
  const [i, setI] = useState<number | null>(null)
  const nums = values.map((v) => (v == null ? 0 : v - baseline))
  const max = Math.max(1, ...nums.map(Math.abs)), W = 300, H = 90, mid = H / 2, bw = W / values.length
  const at = (e: React.PointerEvent<SVGSVGElement>) => { const r = e.currentTarget.getBoundingClientRect(); setI(Math.max(0, Math.min(values.length - 1, Math.floor(((e.clientX - r.left) / r.width) * values.length)))) }
  return (
    <div style={{ padding: '0 16px 12px' }}>
      <div className="cap" style={{ minHeight: 20 }}>{i != null ? readout(i) : 'Touch and slide to read a hole'}</div>
      <svg viewBox={`0 0 ${W} ${H + 14}`} role="img" aria-label={title} style={{ width: '100%', touchAction: 'pan-y' }} onPointerDown={at} onPointerMove={at} onPointerLeave={() => setI(null)}>
        <line x1="0" x2={W} y1={mid} y2={mid} stroke="var(--line)" />
        {nums.map((v, k) => {
          const h = Math.max((Math.abs(v) / max) * (mid - 6), 1.5)
          return <rect key={k} x={k * bw + 1.5} width={bw - 3} y={v > 0 ? mid - h : mid} height={h} rx="1.5" fill={v === 0 ? 'var(--muted)' : v > 0 ? 'var(--c-clay)' : 'var(--c-green)'} opacity={i == null || i === k ? 1 : 0.45} />
        })}
        {labels.map((l, k) => <text key={k} x={k * bw + bw / 2} y={H + 10} fontSize="7" textAnchor="middle" fill="var(--muted)">{l}</text>)}
      </svg>
    </div>
  )
}

/** Horizontal bars for a short list, sorted by the caller. */
export function HBars({ rows, unit = '' }: { rows: { label: string; value: number; note?: string; color?: string }[]; unit?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <div style={{ display: 'grid', gap: 10, padding: '4px 16px 12px' }}>
      {rows.map((r) => (
        <div key={r.label}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{r.label}</span><b>{r.value}{unit}</b></div>
          <div style={{ height: 10, background: 'var(--line)', borderRadius: 5 }}><div style={{ width: `${(r.value / max) * 100}%`, height: '100%', background: r.color ?? 'var(--c-clay)', borderRadius: 5 }} /></div>
          {r.note && <div className="cap" style={{ color: 'var(--muted)' }}>{r.note}</div>}
        </div>
      ))}
    </div>
  )
}

/** One stacked bar split into labelled parts. */
export function Split({ parts }: { parts: { label: string; value: number; color: string }[] }) {
  const n = parts.reduce((a, p) => a + p.value, 0) || 1
  return (
    <div style={{ padding: '4px 16px 12px' }}>
      <div style={{ display: 'flex', height: 18, borderRadius: 9, overflow: 'hidden', background: 'var(--line)' }} role="img" aria-label={parts.map((p) => `${p.label} ${p.value}`).join(', ')}>
        {parts.filter((p) => p.value > 0).map((p) => <div key={p.label} style={{ width: `${(p.value / n) * 100}%`, background: p.color }} />)}
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 6 }}>
        {parts.map((p) => <span key={p.label} className="cap"><span aria-hidden style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: p.color, marginRight: 4 }} />{p.label} {p.value}</span>)}
      </div>
    </div>
  )
}
