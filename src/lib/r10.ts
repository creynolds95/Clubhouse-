import { parseCsv } from './csv'
import type { R10Metric, R10Shot } from '../../shared/types'

/** Header patterns, checked in order (specific before general). Garmin headers look like "[mph] Club head speed". */
const METRICS: [R10Metric, RegExp][] = [
  ['faceToPath', /face\s*to\s*path/],
  ['spinAxis', /spin\s*axis/],
  ['spin', /^spin\s*rate$|^total\s*spin/],
  ['spin', /spin\s*rate(?!\s*type)|back\s*spin|^spin\b/],
  ['launchDir', /launch\s*direction|horizontal\s*launch/],
  ['launch', /launch\s*angle|vertical\s*launch|^launch\b/],
  ['clubSpeed', /club\s*(head\s*)?speed|clubhead/],
  ['ballSpeed', /ball\s*speed/],
  ['smash', /smash|smach/],
  ['attack', /attack/],
  ['path', /club\s*path/],
  ['face', /club\s*face|face\s*angle/],
  ['offline', /carry\s*deviation\s*dist|offline|lateral|side\s*dist/],
  ['offline', /deviation\s*dist/],
  ['carry', /carry/],
  ['total', /^total\s*dist|^total$/],
  ['total', /total/],
  ['apex', /apex|peak\s*height/],
  ['tempo', /^swing\s*tempo|^tempo$/],
]

const unitOf = (h: string) => /[[(]\s*([^\])]+?)\s*[\])]/.exec(h)?.[1]?.toLowerCase() ?? ''
const clean = (h: string) => h.replace(/[[(][^\])]*[\])]/g, '').trim().toLowerCase()

function num(s: string): number | null {
  let t = s.trim()
  if (!t) return null
  if (/^-?\d+,\d+$/.test(t)) t = t.replace(',', '.')
  const n = Number(t.replace(/[^\d.eE+\-]/g, ''))
  return Number.isFinite(n) && /\d/.test(t) ? n : null
}

/** Convert to mph / yards when the header says otherwise. Unlabelled columns are taken as mph / yards. */
function normalise(metric: R10Metric, unit: string, v: number): number {
  const speed = metric === 'clubSpeed' || metric === 'ballSpeed'
  const dist = metric === 'carry' || metric === 'total' || metric === 'offline'
  if (speed) {
    if (/km\/?[ht]|kph/.test(unit)) return v * 0.621371
    if (unit === 'm/s') return v * 2.23694
  }
  if (dist) {
    if (unit === 'm') return v * 1.09361
    if (unit === 'ft') return v / 3
  }
  return v
}

export interface R10Parse {
  shots: R10Shot[]
  mapped: { header: string; metric: R10Metric; unit: string }[]
  skipped: number
}

/** Returns null when the file doesn't look like launch-monitor data. */
export function parseR10Csv(text: string, fallbackDate: string): R10Parse | null {
  const rows = parseCsv(text)
  if (rows.length < 2) return null
  // The header is the first row that maps at least 3 metrics (Garmin may put a title line above it).
  let hi = -1
  for (let i = 0; i < Math.min(rows.length, 6); i++) {
    const hits = rows[i].filter((h) => METRICS.some(([, re]) => re.test(clean(h)))).length
    if (hits >= 3) { hi = i; break }
  }
  if (hi < 0) return null
  const head = rows[hi]
  const cols = new Map<number, { metric: R10Metric; unit: string }>()
  const used = new Set<R10Metric>()
  // Metric by metric, so the best-named column wins (e.g. "Spin Rate" over "Backspin", "Carry Deviation Distance" over "...Angle").
  for (const [m, re] of METRICS) {
    if (used.has(m)) continue
    const i = head.findIndex((h, idx) => !cols.has(idx) && re.test(clean(h)))
    if (i >= 0) { cols.set(i, { metric: m, unit: unitOf(head[i]) }); used.add(m) }
  }
  if (!used.has('ballSpeed') && !used.has('clubSpeed')) return null

  // Find the date and club columns by header words and, failing that, by what the first data rows contain
  // (headers arrive in the golfer's own language).
  const sample = rows.slice(hi + 1, hi + 6)
  const looksDate = (v: string) => /\d/.test(v) && /[/:.\-]/.test(v) && !Number.isNaN(new Date(v).getTime()) && v.trim().length >= 8
  let timeCol = head.findIndex((h, i) => !cols.has(i) && /date|time|timestamp|tid|dato|datum/.test(clean(h)))
  if (timeCol < 0) timeCol = head.findIndex((_, i) => !cols.has(i) && sample.some((r) => looksDate(r[i] ?? '')))
  // Garmin has both "Club Name" (usually empty) and "Club Type" ("Driver", "7 Iron"). Take the one that has values, preferring "type".
  const filled = (i: number) => sample.some((r) => (r[i] ?? '').trim() !== '')
  const clubRank = (h: string) => (/club\s*type|kølle/.test(h) ? 0 : /^club$/.test(h) ? 1 : /club/.test(h) ? 2 : /type|name|navn/.test(h) ? 3 : 9)
  let clubCol = head.map((h, i) => ({ i, r: clubRank(clean(h)) }))
    .filter(({ i, r }) => r < 9 && !cols.has(i) && i !== timeCol && filled(i))
    .sort((a, b) => a.r - b.r)[0]?.i ?? -1
  if (clubCol < 0) clubCol = head.findIndex((_, i) => !cols.has(i) && i !== timeCol && sample.some((r) => /[a-zA-ZæøåäöüÆØÅ]/.test(r[i] ?? '')))

  const shots: R10Shot[] = []
  let skipped = 0
  for (const r of rows.slice(hi + 1)) {
    const m: R10Shot['m'] = {}
    for (const [i, { metric, unit }] of cols) {
      const v = num(r[i] ?? '')
      if (v != null) m[metric] = Math.round(normalise(metric, unit, v) * 100) / 100
    }
    if (Object.keys(m).length < 2) { skipped++; continue } // blank rows
    if (timeCol >= 0 && !looksDate(r[timeCol] ?? '')) { skipped++; continue } // Average / Consistency summary rows have no date
    let hitAt: string | null = null
    if (timeCol >= 0 && r[timeCol]) {
      const d = new Date(r[timeCol])
      if (!Number.isNaN(d.getTime())) hitAt = d.toISOString()
    }
    shots.push({
      sessionDate: hitAt ? localDate(new Date(hitAt)) : fallbackDate,
      hitAt,
      club: clubCol >= 0 ? (r[clubCol] || '').trim() || null : null,
      m,
    })
  }
  if (!shots.length) return null
  return {
    shots, skipped,
    mapped: [...cols].map(([i, v]) => ({ header: head[i].trim(), metric: v.metric, unit: v.unit })),
  }
}

export const localDate = (d: Date) => d.toLocaleDateString('en-CA')

export const METRIC_LABEL: Record<R10Metric, string> = {
  clubSpeed: 'Club speed', ballSpeed: 'Ball speed', smash: 'Smash factor', carry: 'Carry', total: 'Total',
  attack: 'Attack angle', path: 'Club path', face: 'Face angle', faceToPath: 'Face to path', launch: 'Launch angle',
  launchDir: 'Launch direction', spin: 'Spin rate', spinAxis: 'Spin axis', apex: 'Apex', offline: 'Offline', tempo: 'Swing tempo',
}
