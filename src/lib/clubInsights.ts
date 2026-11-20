import { CLUB_CHOICES, type R10Shot } from '../../shared/types'

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const std = (xs: number[]) => { const m = mean(xs); return m == null || xs.length < 2 ? null : Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)) }
const vals = (ss: R10Shot[], k: keyof R10Shot['m']) => ss.map((s) => s.m[k]).filter((v): v is number => v != null)

/** Map Garmin club names ("7 Iron", "Pitching Wedge", "3 Wood") onto the bag's standard names. Null when unrecognised. */
export function normClub(raw: string | null): string | null {
  if (!raw) return null
  const s = raw.trim().toLowerCase()
  const direct = CLUB_CHOICES.find((c) => c.toLowerCase() === s)
  if (direct) return direct
  const num = s.match(/(\d+)/)?.[1]
  if (/driver/.test(s)) return 'Driver'
  if (/wood/.test(s) && num) return `${num} Wood`
  if (/hybrid|rescue/.test(s) && num) return `${num} Hybrid`
  if (/iron/.test(s) && num) return `${num} Iron`
  if (/pitch/.test(s)) return 'PW'
  if (/gap|approach/.test(s)) return 'GW'
  if (/sand/.test(s)) return 'SW'
  if (/lob/.test(s)) return 'LW'
  if (/putt/.test(s)) return 'Putter'
  return null
}
const order = (c: string) => { const i = (CLUB_CHOICES as readonly string[]).indexOf(c); return i < 0 ? 99 : i }

/** Clubs seen in the shot data, in bag order, ready to merge into the profile. */
export const clubsInData = (shots: R10Shot[]) => [...new Set(shots.map((s) => normClub(s.club)).filter((c): c is string => !!c))].sort((a, b) => order(a) - order(b))

export interface ClubInsight {
  club: string; n: number
  carry: number; carrySd: number | null; total: number | null
  /** Gap to the next shorter club, yards. */
  gap: number | null
  clubSpeed: number | null; smash: number | null
  /** Share of shots starting right / left of target (launch direction past ±2°) and curving right / left (spin axis past ±3°). Garmin: positive is right. */
  startRight: number; startLeft: number; curveRight: number; curveLeft: number
  /** Plain-words miss summary, or null with too few shots. */
  miss: string | null
  /** Average carry per session, oldest first. */
  trend: number[]
  /** Change in carry, newest session vs the one before it. */
  delta: number | null
}

const pct = (xs: number[], f: (v: number) => boolean) => (xs.length ? Math.round((xs.filter(f).length / xs.length) * 100) : 0)

export function clubInsights(shots: R10Shot[], minShots = 3): ClubInsight[] {
  const by = new Map<string, R10Shot[]>()
  for (const s of shots) { const c = normClub(s.club); if (c && s.m.carry != null) by.set(c, [...(by.get(c) ?? []), s]) }
  const rows: ClubInsight[] = [...by].filter(([, ss]) => ss.length >= minShots).map(([club, ss]) => {
    const carries = vals(ss, 'carry')
    const dir = vals(ss, 'launchDir'), axis = vals(ss, 'spinAxis')
    const startRight = pct(dir, (v) => v > 2), startLeft = pct(dir, (v) => v < -2)
    const curveRight = pct(axis, (v) => v > 3), curveLeft = pct(axis, (v) => v < -3)
    const bits: string[] = []
    if (dir.length >= minShots) { if (startRight >= 40) bits.push(`starts right ${startRight}%`); else if (startLeft >= 40) bits.push(`starts left ${startLeft}%`) }
    if (axis.length >= minShots) { if (curveRight >= 40) bits.push(`curves right ${curveRight}%`); else if (curveLeft >= 40) bits.push(`curves left ${curveLeft}%`) }
    const miss = dir.length >= minShots || axis.length >= minShots ? (bits.length ? bits.join(', ') : 'mostly straight') : null
    const byDay = new Map<string, number[]>()
    for (const s of ss) byDay.set(s.sessionDate, [...(byDay.get(s.sessionDate) ?? []), s.m.carry!])
    const trend = [...byDay].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([, xs]) => Math.round(mean(xs)!))
    const tot = vals(ss, 'total'), sp = vals(ss, 'clubSpeed'), sm = vals(ss, 'smash')
    return {
      club, n: ss.length, carry: Math.round(mean(carries)!), carrySd: std(carries) == null ? null : Math.round(std(carries)!), total: tot.length ? Math.round(mean(tot)!) : null, gap: null,
      clubSpeed: sp.length ? Math.round(mean(sp)! * 10) / 10 : null, smash: sm.length ? Math.round(mean(sm)! * 100) / 100 : null,
      startRight, startLeft, curveRight, curveLeft, miss, trend,
      delta: trend.length >= 2 ? trend[trend.length - 1] - trend[trend.length - 2] : null,
    }
  }).sort((a, b) => b.carry - a.carry)
  rows.forEach((r, i) => { if (i < rows.length - 1) r.gap = r.carry - rows[i + 1].carry })
  return rows
}

/** Flags a yardage gap worth fixing: too big leaves a hole in the bag, too small means two clubs do one job. */
export const gapNote = (gap: number | null) => (gap == null ? null : gap > 20 ? 'big gap' : gap < 7 ? 'overlap' : null)

/** Club families and their colours, used the same way everywhere a club appears. The label always accompanies the colour. */
export const clubGroup = (club: string): { key: string; label: string; color: string } =>
  /driver|wood/i.test(club) ? { key: 'wood', label: 'Wood', color: 'var(--c-navy)' }
  : /hybrid/i.test(club) ? { key: 'hybrid', label: 'Hybrid', color: 'var(--c-slate)' }
  : /iron/i.test(club) ? { key: 'iron', label: 'Iron', color: 'var(--c-green)' }
  : /^(PW|GW|SW|LW)$/i.test(club) ? { key: 'wedge', label: 'Wedge', color: 'var(--c-gold)' }
  : /putter/i.test(club) ? { key: 'putter', label: 'Putter', color: 'var(--c-plum)' }
  : { key: 'other', label: 'Club', color: 'var(--muted)' }
