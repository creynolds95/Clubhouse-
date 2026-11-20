import { normClub } from './clubInsights'
import type { R10Shot, Swing } from '../../shared/types'

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN)

/**
 * Candidate R10 shots for a swing, best first. Same club first, then closest in time.
 * Phone and launch-monitor clocks can disagree and the shot time may be missing, so this only suggests; the player confirms.
 */
export function shotsForSwing(swing: Swing, shots: R10Shot[], limit = 12): { shot: R10Shot; deltaSec: number | null; sameClub: boolean }[] {
  const t = ms(swing.takenAt ?? swing.createdAt), day = (swing.takenAt ?? swing.createdAt).slice(0, 10)
  const club = normClub(swing.club)
  return shots
    .filter((s) => !s.swingId || s.swingId === swing.id)
    .map((shot) => {
      const h = ms(shot.hitAt)
      return { shot, deltaSec: Number.isNaN(h) || Number.isNaN(t) ? null : Math.round(Math.abs(h - t) / 1000), sameClub: !!club && normClub(shot.club) === club }
    })
    .sort((a, b) => Number(b.sameClub) - Number(a.sameClub) || (a.deltaSec ?? 9e9) - (b.deltaSec ?? 9e9) || (a.shot.sessionDate === day ? -1 : 1))
    .slice(0, limit)
}

/** Candidate swings for an R10 shot, best first: untagged, same club, closest in time. */
export function swingsForShot(shot: R10Shot, swings: Swing[], limit = 12) {
  const h = ms(shot.hitAt), club = normClub(shot.club)
  return swings
    .filter((s) => !s.r10ShotId || s.r10ShotId === shot.id)
    .map((swing) => {
      const t = ms(swing.takenAt ?? swing.createdAt)
      return { swing, deltaSec: Number.isNaN(h) || Number.isNaN(t) ? null : Math.round(Math.abs(h - t) / 1000), sameClub: !!club && normClub(swing.club) === club }
    })
    .sort((a, b) => Number(b.sameClub) - Number(a.sameClub) || (a.deltaSec ?? 9e9) - (b.deltaSec ?? 9e9))
    .slice(0, limit)
}

export const fmtDelta = (s: number | null) => (s == null ? 'time unknown' : s < 90 ? `${s}s apart` : s < 5400 ? `${Math.round(s / 60)} min apart` : `${Math.round(s / 3600)} h apart`)
