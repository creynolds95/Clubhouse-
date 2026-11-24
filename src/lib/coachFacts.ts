import type { Round } from '../../shared/types'
import { computeStats, missPatterns, strokesLost } from './stats'
import type { Summary } from './roundSummary'

const sign = (n: number) => (n > 0 ? `+${n}` : n === 0 ? 'E' : `${n}`)

/** Plain-text facts about one round for the coach. Only numbers the app already computed. */
export function roundFacts(round: Round, s: Summary): string {
  const par = round.holes.reduce((a, h) => a + h.par, 0)
  const lines = [`${round.course}${round.tees ? ` (${round.tees} tees)` : ''}, ${round.holes.length} holes: ${round.total} (${sign(round.total - par)}).`]
  lines.push(`Per hole vs par: ${s.vsPar.map(sign).join(' ')}.`)
  if (s.nines) lines.push(`Front nine ${s.nines.front} (par ${s.nines.frontPar}), back nine ${s.nines.back} (par ${s.nines.backPar}).`)
  if (s.fairway) lines.push(`Fairways: ${s.fairway.hit} hit, ${s.fairway.left} left, ${s.fairway.right} right of ${s.fairway.n}.`)
  if (s.gir) lines.push(`Greens in regulation: ${s.gir.yes} of ${s.gir.n}.`)
  const putts = s.putts.filter((x): x is number => x != null)
  if (putts.length) lines.push(`Putts: ${putts.reduce((a, b) => a + b, 0)} total.`)
  if (s.lost) lines.push(`Strokes lost (estimate): ${s.lost.map((l) => `${l.label} ${l.shots} (${l.note})`).join('; ')}.`)
  for (const v of s.vsAvg) if (v.now != null && v.avg != null) lines.push(`${v.label}: ${v.now}${v.suffix} this round vs ${v.avg}${v.suffix} average.`)
  lines.push(`Headlines: ${s.headlines.join(' ')}`)
  return lines.join('\n')
}

/** Plain-text trend facts across recent rounds. */
export function trendFacts(rounds: Round[]): string {
  const st = computeStats(rounds)
  const lines = [`${st.rounds} recent rounds. Scoring average ${st.scoringAvg ?? 'n/a'} (${st.toPar != null ? sign(st.toPar) : 'n/a'} to par).`]
  lines.push(`Putts per round ${st.puttsPerRound ?? 'n/a'}, 3-putts per round ${st.threePuttsPerRound ?? 'n/a'}, fairways ${st.fairwayPct ?? 'n/a'}%, greens ${st.girPct ?? 'n/a'}%, up-and-down ${st.upDownPct ?? 'n/a'}%, penalties per round ${st.penaltiesPerRound ?? 'n/a'}.`)
  lines.push(`Average strokes over par: par 3s ${st.byPar[3] ?? 'n/a'}, par 4s ${st.byPar[4] ?? 'n/a'}, par 5s ${st.byPar[5] ?? 'n/a'}.`)
  const l = strokesLost(rounds)
  if (l) lines.push(`Strokes lost per 18 (estimate): ${l.map((x) => `${x.label} ${x.shots} (${x.note})`).join('; ')}.`)
  const m = missPatterns(rounds)
  if (m) lines.push(`Tee shot misses: ${JSON.stringify(m)}.`)
  return lines.join('\n')
}
