import type { R10Shot } from '../../shared/types'
import { normClub } from './clubInsights'

export interface Drill { title: string; how: string }
export interface Note {
  /** Stable per club, rule and latest session, so a dismissed note stays gone until the data changes. */
  id: string
  club: string | null
  /** caution: watch out. info: good to know. use: how to play the club. */
  tone: 'caution' | 'info' | 'use'
  text: string
  drill?: Drill
}

// Built-in drill library, keyed by the pattern. The coach can tailor these to the profile once it is switched on.
export const DRILLS: Record<string, Drill> = {
  startRight: { title: 'Gate drill', how: 'Set two tees a clubhead apart just ahead of the ball, on your target line. Hit 10 balls through the gate. Check your feet, hips and shoulders point at the line, not right of it.' },
  startLeft: { title: 'Alignment sticks', how: 'Lay one club along your toe line and one on the ball-to-target line. Hit 10 balls and check each time that your body lines up parallel to the target line, not left of it.' },
  curveRight: { title: 'Face-to-path drill', how: 'Hit 10 balls at half speed focusing on a square face at impact. Feel the lead wrist flat and the trail forearm turn over through the strike.' },
  curveLeft: { title: 'Release check', how: 'Hit 10 balls at half speed holding the finish. Feel the clubface stay quiet through impact instead of closing early, and let the hands lead.' },
  spread: { title: 'Tempo drill', how: 'Hit 10 balls counting "one-two-three" back, "one" down (about 3 to 1). Same rhythm every ball. Finish balanced and hold it for two seconds.' },
  distance: { title: 'Distance ladder', how: 'Pick three targets at different yardages. Hit three balls to each in turn, never the same target twice in a row. Count how many land within 10 yards.' },
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const sd = (xs: number[]) => { const m = mean(xs); return m == null || xs.length < 2 ? null : Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)) }
const share = (xs: number[], f: (v: number) => boolean) => (xs.length ? xs.filter(f).length / xs.length : 0)
const pct = (x: number) => Math.round(x * 100)

const MIN_RULE = 8   // shots needed before a miss or spread is called a pattern
const MIN_ROUGH = 3  // below this a club has too little data to show at all

/** Rule-based cautions and encouragements from R10 shots. Calm and factual; no AI. */
export function clubNotes(shots: R10Shot[], today = new Date()): Note[] {
  const notes: Note[] = []
  const sessions = [...new Set(shots.map((s) => s.sessionDate))].sort()
  const latest = sessions[sessions.length - 1]
  if (!latest) return notes
  const age = Math.floor((today.getTime() - Date.parse(latest)) / 86_400_000)
  if (age >= 30) notes.push({ id: `stale:${latest}`, club: null, tone: 'info', text: `Your last range session was ${age} days ago. These numbers may have drifted.` })

  const by = new Map<string, R10Shot[]>()
  for (const s of shots) { const c = normClub(s.club); if (c && s.m.carry != null) by.set(c, [...(by.get(c) ?? []), s]) }
  for (const [club, ss] of by) {
    const n = ss.length
    const carries = ss.map((s) => s.m.carry!)
    if (n < MIN_ROUGH) continue
    if (n < MIN_RULE) { notes.push({ id: `rough:${club}:${latest}`, club, tone: 'info', text: `${club}: only ${n} shots, treat the numbers as rough.` }); continue }

    const dir = ss.map((s) => s.m.launchDir).filter((v): v is number => v != null)
    const axis = ss.map((s) => s.m.spinAxis).filter((v): v is number => v != null)
    const sr = share(dir, (v) => v > 2), sl = share(dir, (v) => v < -2), cr = share(axis, (v) => v > 3), cl = share(axis, (v) => v < -3)
    if (dir.length >= MIN_RULE && sr >= 0.6) notes.push({ id: `startRight:${club}:${latest}`, club, tone: 'caution', text: `${club}: starts right of target ${pct(sr)}% of the time.`, drill: DRILLS.startRight })
    else if (dir.length >= MIN_RULE && sl >= 0.6) notes.push({ id: `startLeft:${club}:${latest}`, club, tone: 'caution', text: `${club}: starts left of target ${pct(sl)}% of the time.`, drill: DRILLS.startLeft })
    if (axis.length >= MIN_RULE && cr >= 0.6) notes.push({ id: `curveRight:${club}:${latest}`, club, tone: 'caution', text: `${club}: curves right ${pct(cr)}% of the time.`, drill: DRILLS.curveRight })
    else if (axis.length >= MIN_RULE && cl >= 0.6) notes.push({ id: `curveLeft:${club}:${latest}`, club, tone: 'caution', text: `${club}: curves left ${pct(cl)}% of the time.`, drill: DRILLS.curveLeft })

    const spread = sd(carries), mu = mean(carries)!
    if (spread != null && spread / mu >= 0.08) notes.push({ id: `spread:${club}:${latest}`, club, tone: 'caution', text: `${club}: carry varies about ±${Math.round(spread)} yds. Treat the yardage as a range.`, drill: DRILLS.spread })

    // How to use a steady club: short clubs attack pins, long clubs are for layups and tee shots.
    const missy = Math.max(sr, sl, cr, cl) >= 0.5
    if (spread != null && spread / mu <= 0.04 && !missy) {
      const short = /^(PW|GW|SW|LW|9 Iron|8 Iron|7 Iron)$/.test(club)
      notes.push({ id: `steady:${club}:${latest}`, club, tone: 'use', text: short ? `${club} carries a steady ${Math.round(mu)} (±${Math.round(spread)}). Trust it to attack pins at that number.` : `${club} carries a steady ${Math.round(mu)} (±${Math.round(spread)}). Use it for layups and safe tee shots at that number.` })
    }

    // Change over time: latest session against everything before it (each side needs enough shots).
    const last = ss.filter((s) => s.sessionDate === latest), before = ss.filter((s) => s.sessionDate !== latest)
    if (last.length >= 5 && before.length >= 5) {
      const dl = mean(last.map((s) => s.m.carry!))! - mean(before.map((s) => s.m.carry!))!
      if (Math.abs(dl) >= 6) notes.push({ id: `shift:${club}:${latest}`, club, tone: 'info', text: `${club}: carrying ${Math.abs(Math.round(dl))} yds ${dl > 0 ? 'longer' : 'shorter'} than before. Use ${Math.round(mean(last.map((s) => s.m.carry!))!)} as its number now.` })
      const s1 = sd(last.map((s) => s.m.carry!)), s0 = sd(before.map((s) => s.m.carry!))
      if (s1 != null && s0 != null && s0 >= 4 && s1 <= s0 * 0.75) notes.push({ id: `tighter:${club}:${latest}`, club, tone: 'use', text: `${club}: carry is tighter than before (±${Math.round(s1)} vs ±${Math.round(s0)} yds). Trust it more at its number.` })
      const dirB = before.map((s) => s.m.spinAxis).filter((v): v is number => v != null), dirL = last.map((s) => s.m.spinAxis).filter((v): v is number => v != null)
      if (dirB.length >= 5 && dirL.length >= 5) {
        const old = Math.max(share(dirB, (v) => v > 3), share(dirB, (v) => v < -3)), now = Math.max(share(dirL, (v) => v > 3), share(dirL, (v) => v < -3))
        if (old >= 0.6 && now <= 0.4) notes.push({ id: `fixed:${club}:${latest}`, club, tone: 'use', text: `${club}: the curve has improved (${pct(old)}% down to ${pct(now)}%). You can aim closer to the target with it.` })
      }
    }
  }
  return notes
}

/** Gap and overlap notes, from the distance ladder rows (carry, high to low). */
export function gapNotes(rows: { club: string; carry: number; gap: number | null }[]): Note[] {
  return rows.flatMap((r, i): Note[] => {
    const next = rows[i + 1]
    if (r.gap == null || !next) return []
    if (r.gap > 20) return [{ id: `gap:${r.club}:${next.club}:${r.carry}`, club: r.club, tone: 'info', text: `${r.gap} yds between ${r.club} and ${next.club}. A hole in the bag around ${next.carry + Math.round(r.gap / 2)}.` }]
    if (r.gap < 7) return [{ id: `overlap:${r.club}:${next.club}:${r.carry}`, club: r.club, tone: 'info', text: `${r.club} and ${next.club} carry within ${r.gap} yds of each other.` }]
    return []
  })
}

const KEY = 'clubhouse.dismissed'
export const dismissed = (): string[] => { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') } catch { return [] } }
export const dismiss = (id: string) => { try { localStorage.setItem(KEY, JSON.stringify([...new Set([...dismissed(), id])].slice(-200))) } catch { /* private mode */ } }
