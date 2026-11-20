// Pure mapping from outside course data to our Course shape. No imports, so it can be tested on its own.
import type { CourseCandidate, CourseHole, CourseTee } from './types'

type OsmEl = { type: string; id: number; tags?: Record<string, string>; center?: { lat: number; lon: number } }

type NomRow = { osm_type?: string; osm_id?: number; lat?: string; lon?: string; name?: string; category?: string; class?: string; type?: string; address?: Record<string, string> }

/** Nominatim search rows (format=jsonv2, addressdetails=1) that are golf courses. Same id format as Overpass, e.g. "way/123". */
export function nomCandidates(rows: NomRow[]): CourseCandidate[] {
  return rows
    .filter((r) => r.name && r.osm_type && r.osm_id && (r.type === 'golf_course' || (r.category ?? r.class) === 'leisure'))
    .map((r) => {
      const a = r.address ?? {}
      const lat = Number(r.lat), lon = Number(r.lon)
      return {
        source: 'osm' as const,
        externalId: `${r.osm_type}/${r.osm_id}`,
        name: r.name!,
        city: a.city ?? a.town ?? a.village ?? a.suburb ?? null,
        state: a['ISO3166-2-lvl4']?.replace(/^US-/, '') ?? a.state ?? null,
        ...(Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : {}),
      }
    })
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

// OpenGolfAPI (api.opengolfapi.org). List rows: id, course_name, city, state, latitude, longitude.
// Detail/tee/hole shapes are not fully documented, so field names are matched tolerantly.
type OgRow = { id?: number | string; course_name?: string; city?: string; state?: string; latitude?: number | string; longitude?: number | string }
export function ogCandidates(rows: OgRow[]): CourseCandidate[] {
  return rows.filter((r) => r.id != null && r.course_name).map((r) => {
    const lat = Number(r.latitude), lon = Number(r.longitude)
    return {
      source: 'opengolf' as const, externalId: String(r.id), name: r.course_name!, city: r.city ?? null, state: r.state ?? null,
      ...(r.latitude != null && r.longitude != null && Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : {}),
    }
  })
}

type Any = Record<string, unknown>
const num = (...v: unknown[]) => { for (const x of v) { const n = Number(x); if (x != null && x !== '' && Number.isFinite(n)) return n } return undefined }
const list = (v: unknown): Any[] => (Array.isArray(v) ? (v as Any[]) : v && typeof v === 'object' ? Object.values(v as Any).flat().filter((x) => x && typeof x === 'object') as Any[] : [])

/** Holes and tees from OpenGolfAPI's detail response (or its /holes and /tees responses merged in). */
export function ogCourse(detail: Any): { holes: CourseHole[]; tees: CourseTee[]; complete: boolean } {
  const holes: CourseHole[] = list(detail.holes).map((h, i) => ({ hole: num(h.hole, h.hole_number, h.number, h.num) ?? i + 1, par: num(h.par) ?? 0, hcp: num(h.handicap, h.hcp, h.stroke_index, h.handicap_index) }))
    .filter((h) => h.par >= 3 && h.par <= 6).sort((a, b) => a.hole - b.hole).map((h) => (h.hcp ? h : { hole: h.hole, par: h.par }))
  const seen = new Set<string>()
  const tees: CourseTee[] = list(detail.tees).map((t) => ({
    name: String(t.name ?? t.tee_name ?? t.color ?? ''), rating: num(t.course_rating, t.rating), slope: num(t.slope_rating, t.slope), totalYards: num(t.total_yards, t.yardage, t.yards, t.total_yardage),
  })).filter((t) => t.name && (seen.has(t.name) ? false : seen.add(t.name)))
  return { holes, tees, complete: (holes.length === 9 || holes.length === 18) && holes.every((h, i) => h.hole === i + 1) }
}

const RANK: Record<string, number> = { golfcourseapi: 3, opengolf: 2, osm: 1 }
/**
 * Collapse the same course found by several sources into one row. The row kept is the source with the most detail
 * (GolfCourseAPI, then OpenGolfAPI, then OpenStreetMap). Twins share a normalised name, or sit within 1.5 km with one name inside the other.
 */
export function mergeCandidates(cs: CourseCandidate[]): CourseCandidate[] {
  const sorted = [...cs].sort((a, b) => (RANK[b.source] ?? 0) - (RANK[a.source] ?? 0))
  const out: CourseCandidate[] = []
  for (const c of sorted) {
    const n = normName(c.name)
    const twin = out.find((o) => {
      if (o.source === c.source && o.externalId === c.externalId) return true
      if (o.source === c.source) return false
      const m = normName(o.name)
      if (n === m) return true
      const near = o.lat != null && o.lon != null && c.lat != null && c.lon != null && distKm(o.lat, o.lon, c.lat, c.lon) < 1.5
      return near && n.length > 2 && m.length > 2 && (n.includes(m) || m.includes(n))
    })
    if (twin) {
      twin.tags = [...new Set([...(twin.tags ?? [twin.source]), c.source])]
      if (!(twin.source === c.source && twin.externalId === c.externalId)) (twin.alts ??= []).push({ source: c.source, externalId: c.externalId })
      twin.lat ??= c.lat; twin.lon ??= c.lon; twin.city ??= c.city; twin.state ??= c.state
    } else out.push({ ...c, tags: [c.source], alts: [] })
  }
  return out
}
