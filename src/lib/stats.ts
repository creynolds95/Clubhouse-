import type { Round } from '../../shared/types'

export interface RoundStats {
  rounds: number
  scoringAvg: number | null
  toPar: number | null
  puttsPerRound: number | null
  fairwayPct: number | null
  girPct: number | null
  penaltiesPerRound: number | null
  byPar: Record<3 | 4 | 5, number | null> // avg strokes over par
  upDownPct: number | null
  threePuttsPerRound: number | null
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const r1 = (n: number | null) => (n == null ? null : Math.round(n * 10) / 10)

/** Rounds normalised to 18 holes where a stat is per-round. */
export function computeStats(rounds: Round[]): RoundStats {
  const holes = rounds.flatMap((r) => r.holes)
  const perRound = (f: (r: Round) => number | null) => r1(avg(rounds.map(f).filter((x): x is number => x != null)))
  const scale = (r: Round) => 18 / r.holes.length
  const fw = holes.filter((h) => h.par >= 4 && h.fairway && h.fairway !== 'na')
  const gir = holes.filter((h) => h.gir != null)
  const parAvg = (p: number) => r1(avg(holes.filter((h) => h.par === p).map((h) => h.strokes - h.par)))
  return {
    rounds: rounds.length,
    scoringAvg: perRound((r) => r.total * scale(r)),
    toPar: perRound((r) => (r.total - r.holes.reduce((s, h) => s + h.par, 0)) * scale(r)),
    puttsPerRound: perRound((r) => (r.holes.every((h) => h.putts != null) ? r.holes.reduce((s, h) => s + h.putts!, 0) * scale(r) : null)),
    fairwayPct: fw.length ? Math.round((fw.filter((h) => h.fairway === 'hit').length / fw.length) * 100) : null,
    girPct: gir.length ? Math.round((gir.filter((h) => h.gir).length / gir.length) * 100) : null,
    penaltiesPerRound: perRound((r) => r.holes.reduce((s, h) => s + (h.penalties ?? 0), 0) * scale(r)),
    byPar: { 3: parAvg(3), 4: parAvg(4), 5: parAvg(5) },
    upDownPct: (() => { const m = holes.filter((h) => h.gir === false && h.upDown != null); return m.length ? Math.round((m.filter((h) => h.upDown).length / m.length) * 100) : null })(),
    threePuttsPerRound: perRound((r) => (r.holes.every((h) => h.putts != null) ? r.holes.filter((h) => h.putts! >= 3).length * scale(r) : null)),
  }
}

/** Fairway misses split left and right, as a share of fairways with a result. */
export function missPatterns(rounds: Round[]) {
  const fw = rounds.flatMap((r) => r.holes).filter((h) => h.par >= 4 && h.fairway && h.fairway !== 'na')
  if (fw.length < 10) return null
  const pct = (k: string) => Math.round((fw.filter((h) => h.fairway === k).length / fw.length) * 100)
  return { n: fw.length, hit: pct('hit'), left: pct('left'), right: pct('right') }
}

export interface Lost { label: string; shots: number; note: string }
/**
 * Where strokes go, per 18 holes. An estimate from what the scorecard records:
 * putts beyond two, penalty strokes, extra strokes on holes after a missed fairway, and extra strokes on missed greens beyond penalties and putting.
 */
export function strokesLost(rounds: Round[]): Lost[] | null {
  const withPutts = rounds.filter((r) => r.holes.every((h) => h.putts != null))
  if (withPutts.length < 2) return null
  let putting = 0, pen = 0, tee = 0, approach = 0, n = 0
  for (const r of withPutts) {
    const k = 18 / r.holes.length; n++
    const hit = r.holes.filter((h) => h.par >= 4 && h.fairway === 'hit').map((h) => h.strokes - h.par)
    const base = hit.length ? hit.reduce((a, b) => a + b, 0) / hit.length : 0
    for (const h of r.holes) {
      const extraPutts = Math.max(0, (h.putts ?? 2) - 2), p = h.penalties ?? 0
      putting += extraPutts * k; pen += p * k
      if (h.par >= 4 && (h.fairway === 'left' || h.fairway === 'right')) tee += Math.max(0, h.strokes - h.par - p - base) * k
      if (h.gir === false) approach += Math.max(0, h.strokes - h.par - p - extraPutts) * k
    }
  }
  const r1 = (x: number) => Math.round((x / n) * 10) / 10
  return ([
    { label: 'Putting', shots: r1(putting), note: 'putts beyond two per hole' },
    { label: 'Penalties', shots: r1(pen), note: 'penalty strokes' },
    { label: 'Off the tee', shots: r1(tee), note: 'extra strokes after a missed fairway' },
    { label: 'Approach and short game', shots: r1(approach), note: 'extra strokes after a missed green' },
  ] as Lost[]).sort((a, b) => b.shots - a.shots)
}

export interface CourseHistory { course: string; rounds: number; avg: number; best: number; last: string; putts: number | null; fairwayPct: number | null; girPct: number | null }
export function byCourse(rounds: Round[]): CourseHistory[] {
  const m = new Map<string, Round[]>()
  for (const r of rounds) m.set(r.course, [...(m.get(r.course) ?? []), r])
  return [...m].map(([course, rs]) => {
    const st = computeStats(rs), full = rs.filter((r) => r.holes.length === 18)
    return { course, rounds: rs.length, avg: st.scoringAvg ?? 0, best: full.length ? Math.min(...full.map((r) => r.total)) : Math.min(...rs.map((r) => r.total)), last: rs[0].playedOn, putts: st.puttsPerRound, fairwayPct: st.fairwayPct, girPct: st.girPct }
  }).sort((a, b) => (a.last < b.last ? 1 : -1))
}
