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
  }
}
