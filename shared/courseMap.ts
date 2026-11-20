// Pure mapping from outside course data to our Course shape. No imports, so it can be tested on its own.
import type { CourseCandidate, CourseHole, CourseTee } from './types'

type OsmEl = { type: string; id: number; tags?: Record<string, string>; center?: { lat: number; lon: number } }

export function osmCandidates(elements: OsmEl[]): CourseCandidate[] {
  return elements
    .filter((e) => e.tags?.name)
    .map((e) => ({
      source: 'osm' as const,
      externalId: `${e.type}/${e.id}`,
      name: e.tags!.name,
      city: e.tags!['addr:city'] ?? null,
      state: e.tags!['addr:state'] ?? null,
      ...(e.center ? { lat: e.center.lat, lon: e.center.lon } : {}),
    }))
}

/** Hole ways carry ref (number), par and handicap tags where a mapper added them. Duplicated refs (27-hole sites) keep the first. */
export function osmHoles(elements: OsmEl[]): { holes: CourseHole[]; complete: boolean } {
  const seen = new Map<number, CourseHole>()
  for (const e of elements) {
    const ref = parseInt(e.tags?.ref ?? '', 10)
    const par = parseInt(e.tags?.par ?? '', 10)
    if (!Number.isFinite(ref) || !Number.isFinite(par) || par < 3 || par > 6 || ref < 1 || ref > 18 || seen.has(ref)) continue
    const hcp = parseInt(e.tags?.handicap ?? '', 10)
    seen.set(ref, { hole: ref, par, ...(Number.isFinite(hcp) ? { hcp } : {}) })
  }
  const holes = [...seen.values()].sort((a, b) => a.hole - b.hole)
  const complete = (holes.length === 18 || holes.length === 9) && holes.every((h, i) => h.hole === i + 1)
  return { holes, complete }
}

// GolfCourseAPI response shape as documented on its site: tees.male / tees.female arrays, each with
// tee_name, course_rating, slope_rating, total_yards and holes[{par, yardage, handicap}].
// Field names are matched tolerantly because the docs page could not be fully read.
type GcaTee = { tee_name?: string; course_rating?: number; slope_rating?: number; total_yards?: number; holes?: { par?: number; yardage?: number; handicap?: number }[] }
type GcaCourse = { id?: number | string; club_name?: string; course_name?: string; location?: { city?: string; state?: string; latitude?: number; longitude?: number }; tees?: Record<string, GcaTee[]> | GcaTee[] }

export function gcaCandidates(courses: GcaCourse[]): CourseCandidate[] {
  return courses.filter((c) => c.id != null).map((c) => ({
    source: 'golfcourseapi' as const,
    externalId: String(c.id),
    name: [c.club_name, c.course_name && c.course_name !== c.club_name ? c.course_name : null].filter(Boolean).join(' · ') || 'Course',
    city: c.location?.city ?? null,
    state: c.location?.state ?? null,
    ...(typeof c.location?.latitude === 'number' && typeof c.location?.longitude === 'number' ? { lat: c.location.latitude, lon: c.location.longitude } : {}),
  }))
}

export function gcaCourse(c: GcaCourse): { holes: CourseHole[]; tees: CourseTee[]; complete: boolean } {
  const all: GcaTee[] = Array.isArray(c.tees) ? c.tees : Object.values(c.tees ?? {}).flat()
  const withHoles = all.find((t) => (t.holes?.length ?? 0) >= 9)
  const holes: CourseHole[] = (withHoles?.holes ?? [])
    .map((h, i) => ({ hole: i + 1, par: h.par ?? 0, ...(h.handicap ? { hcp: h.handicap } : {}) }))
    .filter((h) => h.par >= 3 && h.par <= 6)
  const tees: CourseTee[] = all.filter((t) => t.tee_name).map((t) => ({
    name: t.tee_name!, rating: t.course_rating, slope: t.slope_rating, totalYards: t.total_yards,
    yards: t.holes?.length ? t.holes.map((h) => h.yardage ?? 0) : undefined,
  }))
  const seen = new Set<string>()
  const unique = tees.filter((t) => (seen.has(t.name) ? false : seen.add(t.name)))
  return { holes, tees: unique, complete: holes.length === 9 || holes.length === 18 }
}

/** Great-circle distance in km. */
export function distKm(aLat: number, aLon: number, bLat: number, bLon: number) {
  const r = Math.PI / 180, dLat = (bLat - aLat) * r, dLon = (bLon - aLon) * r
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLon / 2) ** 2
  return 12742 * Math.asin(Math.sqrt(h))
}

/** Lowercase, drop punctuation and filler words so "Pecan Hollow Golf Course" matches "Pecan Hollow". */
export const normName = (n: string) => n.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\b(golf|course|club|country|the|and|at)\b/g, ' ').replace(/\s+/g, ' ').trim()
