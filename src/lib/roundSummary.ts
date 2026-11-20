import type { Round } from '../../shared/types'
import { computeStats, type Lost } from './stats'

export interface Summary {
  headlines: string[]
  lost: Lost[] | null
  vsPar: number[]
  putts: (number | null)[]
  fairway: { hit: number; left: number; right: number; n: number } | null
  gir: { yes: number; no: number; n: number } | null
  nines: { front: number; back: number; frontPar: number; backPar: number } | null
  vsAvg: { label: string; now: number | null; avg: number | null; lowerIsBetter: boolean; suffix: string }[]
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const r1 = (n: number) => Math.round(n * 10) / 10
const sign = (n: number) => (n > 0 ? `+${n}` : n === 0 ? 'E' : `${n}`)

/** Rule-based after-round summary. `previous` are earlier rounds (newest first) used for "vs your average". */
export function summarize(round: Round, previous: Round[]): Summary {
  const hs = round.holes, k = 18 / hs.length
  const par = sum(hs.map((h) => h.par)), total = sum(hs.map((h) => h.strokes))
  const vsPar = hs.map((h) => h.strokes - h.par)
  const havePutts = hs.every((h) => h.putts != null)

  // Strokes lost, same logic as the Stats screen but for this one round.
  let lost: Lost[] | null = null
  if (havePutts) {
    const hitHoles = hs.filter((h) => h.par >= 4 && h.fairway === 'hit').map((h) => h.strokes - h.par)
    const base = hitHoles.length ? sum(hitHoles) / hitHoles.length : 0
    let putting = 0, pen = 0, tee = 0, appr = 0
    for (const h of hs) {
      const ep = Math.max(0, (h.putts ?? 2) - 2), p = h.penalties ?? 0
      putting += ep; pen += p
      if (h.par >= 4 && (h.fairway === 'left' || h.fairway === 'right')) tee += Math.max(0, h.strokes - h.par - p - base)
      if (h.gir === false) appr += Math.max(0, h.strokes - h.par - p - ep)
    }
    lost = ([
      { label: 'Putting', shots: r1(putting), note: 'putts beyond two' },
      { label: 'Penalties', shots: r1(pen), note: 'penalty strokes' },
      { label: 'Off the tee', shots: r1(tee), note: 'after a missed fairway' },
      { label: 'Approach and short game', shots: r1(appr), note: 'after a missed green' },
    ] as Lost[]).sort((a, b) => b.shots - a.shots)
  }

  const fw = hs.filter((h) => h.par >= 4 && h.fairway && h.fairway !== 'na')
  const fairway = fw.length ? { hit: fw.filter((h) => h.fairway === 'hit').length, left: fw.filter((h) => h.fairway === 'left').length, right: fw.filter((h) => h.fairway === 'right').length, n: fw.length } : null
  const g = hs.filter((h) => h.gir != null)
  const gir = g.length ? { yes: g.filter((h) => h.gir).length, no: g.filter((h) => !h.gir).length, n: g.length } : null
  const nines = hs.length === 18 ? { front: sum(hs.slice(0, 9).map((h) => h.strokes)), back: sum(hs.slice(9).map((h) => h.strokes)), frontPar: sum(hs.slice(0, 9).map((h) => h.par)), backPar: sum(hs.slice(9).map((h) => h.par)) } : null

  // This round against the player's recent average (up to 10 earlier rounds).
  const prev = computeStats(previous.slice(0, 10))
  const nowStats = computeStats([round])
  const vsAvg: Summary['vsAvg'] = prev.rounds ? [
    { label: 'Score', now: nowStats.scoringAvg, avg: prev.scoringAvg, lowerIsBetter: true, suffix: '' },
    { label: 'Putts', now: nowStats.puttsPerRound, avg: prev.puttsPerRound, lowerIsBetter: true, suffix: '' },
    { label: 'Fairways', now: nowStats.fairwayPct, avg: prev.fairwayPct, lowerIsBetter: false, suffix: '%' },
    { label: 'Greens', now: nowStats.girPct, avg: prev.girPct, lowerIsBetter: false, suffix: '%' },
    { label: 'Penalties', now: nowStats.penaltiesPerRound, avg: prev.penaltiesPerRound, lowerIsBetter: true, suffix: '' },
  ] : []

  // Three headlines: the score, the biggest leak, then the strongest thing worth repeating.
  const headlines: string[] = []
  const scoreDiff = prev.scoringAvg != null ? r1(total * k - prev.scoringAvg) : null
  headlines.push(`Shot ${total} (${sign(total - par)})${scoreDiff != null && Math.abs(scoreDiff) >= 1 ? `, ${Math.abs(Math.round(scoreDiff))} ${scoreDiff < 0 ? 'better' : 'worse'} than your recent average` : ''}.`)
  if (lost && lost[0].shots >= 1) headlines.push(`Most strokes went to ${lost[0].label.toLowerCase()}: about ${lost[0].shots} (${lost[0].note}).`)
  else if (lost) headlines.push('No single area cost you more than a stroke. A clean round.')
  const wins: { score: number; text: string }[] = []
  for (const v of vsAvg) {
    if (v.now == null || v.avg == null) continue
    const better = v.lowerIsBetter ? v.avg - v.now : v.now - v.avg, need = v.suffix === '%' ? 12 : v.label === 'Score' ? 2 : 1.5
    if (better >= need) wins.push({ score: better / need, text: `${v.label} was better than usual: ${v.now}${v.suffix} against ${v.avg}${v.suffix}. Repeat what you did there.` })
  }
  const threePutts = hs.filter((h) => (h.putts ?? 0) >= 3).length
  if (havePutts && threePutts === 0) wins.push({ score: 1.2, text: 'No 3-putts. Your lag putting held up.' })
  if (hs.length >= 6) {
    let best = { at: 0, v: 99 }
    for (let i = 0; i + 3 <= hs.length; i++) { const v = sum(vsPar.slice(i, i + 3)); if (v < best.v) best = { at: i, v } }
    if (best.v <= 0) wins.push({ score: 1, text: `Your best stretch was holes ${best.at + 1} to ${best.at + 3}: ${sign(best.v)} over three holes.` })
  }
  wins.sort((a, b) => b.score - a.score)
  if (wins[0]) headlines.push(wins[0].text)
  else if (nines && Math.abs(nines.front - nines.back) >= 3) headlines.push(`Your ${nines.front < nines.back ? 'front' : 'back'} nine was ${Math.abs(nines.front - nines.back)} strokes better.`)

  return { headlines: headlines.slice(0, 3), lost, vsPar, putts: hs.map((h) => h.putts ?? null), fairway, gir, nines, vsAvg }
}
