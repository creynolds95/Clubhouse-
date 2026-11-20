import type { R10Shot, Round, Swing } from '../../shared/types'
import { computeStats } from './stats'

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const std = (xs: number[]) => {
  if (xs.length < 3) return null
  const m = mean(xs)!
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1))
}

export interface ClubRow { club: string; carry: number; spread: number | null; n: number }

/** Average carry per club with spread (std dev of carry, yards). Longest club first. */
export function clubTable(shots: R10Shot[]): ClubRow[] {
  const by = new Map<string, number[]>()
  for (const s of shots) if (s.club && s.m.carry != null) by.set(s.club, [...(by.get(s.club) ?? []), s.m.carry])
  return [...by]
    .map(([club, xs]) => ({ club, carry: Math.round(mean(xs)!), spread: std(xs) == null ? null : Math.round(std(xs)!), n: xs.length }))
    .sort((a, b) => b.carry - a.carry)
}

export function scoring(rounds: Round[]) {
  const last5 = rounds.slice(0, 5), prev5 = rounds.slice(5, 10)
  const cur = computeStats(last5), prev = computeStats(prev5)
  const trend = [...rounds.slice(0, 8)].reverse().map((r) => (r.total * 18) / r.holes.length)
  return {
    avg: cur.scoringAvg, toPar: cur.toPar, n: last5.length,
    delta: cur.scoringAvg != null && prev.scoringAvg != null ? Math.round((cur.scoringAvg - prev.scoringAvg) * 10) / 10 : null,
    trend, stats: computeStats(rounds.slice(0, 10)),
  }
}

export function tempoTrend(swings: Swing[]) {
  const withTempo = swings.filter((s) => s.metrics?.tempoRatio)
  return { latest: withTempo[0]?.metrics?.tempoRatio ?? null, trend: [...withTempo.slice(0, 8)].reverse().map((s) => s.metrics!.tempoRatio!), n: swings.length }
}

/** Practice days in a row ending today or yesterday, and this week's counts (week starts Monday). */
export function practice(swings: Swing[], shots: R10Shot[], rounds: Round[]) {
  const day = (d: Date) => d.toLocaleDateString('en-CA')
  const days = new Set<string>([
    ...swings.map((s) => day(new Date(s.takenAt ?? s.createdAt))),
    ...shots.map((s) => s.sessionDate),
    ...rounds.map((r) => r.playedOn),
  ])
  let streak = 0
  const d = new Date()
  if (!days.has(day(d))) d.setDate(d.getDate() - 1)
  while (days.has(day(d))) { streak++; d.setDate(d.getDate() - 1) }
  const mon = new Date(); mon.setHours(0, 0, 0, 0); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7))
  const since = day(mon)
  return {
    streak,
    swings: swings.filter((s) => day(new Date(s.takenAt ?? s.createdAt)) >= since).length,
    balls: shots.filter((s) => s.sessionDate >= since).length,
  }
}
