import type { Course, CourseCandidate } from '../shared/types'
import { gcaCandidates, gcaCourse, osmCandidates, osmHoles } from '../shared/courseMap'

export interface CourseEnv { DB: D1Database; GOLF_COURSE_API_KEY?: string }

type Row = { id: string; name: string; city: string | null; state: string | null; source: string; holes: string; tees: string; unverified: number }
export const toCourse = (r: Row): Course => ({
  id: r.id, name: r.name, city: r.city, state: r.state, source: r.source as Course['source'],
  holes: JSON.parse(r.holes), tees: JSON.parse(r.tees), unverified: !!r.unverified,
})

// Dallas–Fort Worth, south, west, north, east.
const DFW = '32.0,-98.0,33.6,-96.0'
const UA = 'Clubhouse/1.0 (personal golf app)'
const GCA = 'https://api.golfcourseapi.com/v1'

async function overpass(query: string) {
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': UA }, body: `data=${encodeURIComponent(query)}`,
  })
  if (!res.ok) throw new Error(`OpenStreetMap lookup failed (${res.status})`)
  return (await res.json<{ elements: never[] }>()).elements
}

const gca = async (env: CourseEnv, path: string) => {
  const res = await fetch(`${GCA}${path}`, { headers: { authorization: `Bearer ${env.GOLF_COURSE_API_KEY}`, 'user-agent': UA } })
  if (!res.ok) throw new Error(`GolfCourseAPI lookup failed (${res.status})`)
  return res.json<Record<string, never>>()
}

export const sources = (env: CourseEnv) => ({ osm: true, golfcourseapi: !!env.GOLF_COURSE_API_KEY })

/** Candidates not yet saved. Each source can fail on its own without hiding the other. */
export async function findOnline(env: CourseEnv, q: string) {
  const out: CourseCandidate[] = [], errors: string[] = []
  const safe = q.replace(/[^\w ]/g, '').trim()
  if (safe.length < 3) return { candidates: out, errors }
  if (env.GOLF_COURSE_API_KEY) {
    try { out.push(...gcaCandidates(((await gca(env, `/search?search_query=${encodeURIComponent(safe)}`)) as { courses?: never[] }).courses ?? [])) }
    catch (e) { errors.push((e as Error).message) }
  }
  try { out.push(...osmCandidates(await overpass(`[out:json][timeout:20];nwr["leisure"="golf_course"]["name"~"${safe}",i](${DFW});out tags center 15;`))) }
  catch (e) { errors.push((e as Error).message) }
  return { candidates: out, errors }
}

export async function importCourse(env: CourseEnv, c: CourseCandidate): Promise<Course> {
  const existing = await env.DB.prepare('SELECT * FROM courses WHERE source = ? AND external_id = ?').bind(c.source, c.externalId).first<Row>()
  if (existing) return toCourse(existing)

  let holes: Course['holes'] = [], tees: Course['tees'] = [], complete = false
  if (c.source === 'golfcourseapi') {
    const detail = (await gca(env, `/courses/${encodeURIComponent(c.externalId)}`)) as never
    const d = ((detail as { course?: never }).course ?? detail) as Parameters<typeof gcaCourse>[0]
    ;({ holes, tees, complete } = gcaCourse(d))
  } else {
    const [type, id] = c.externalId.split('/')
    if (!['way', 'relation'].includes(type) || !/^\d+$/.test(id)) throw new Error('Unknown course')
    ;({ holes, complete } = osmHoles(await overpass(`[out:json][timeout:25];${type}(${id});map_to_area->.a;way["golf"="hole"](area.a);out tags;`)))
  }
  // Fill any missing holes with par 4 so the course is usable; it is flagged so the pars get checked.
  const n = holes.length > 9 ? 18 : 9
  const byHole = new Map(holes.map((h) => [h.hole, h]))
  const filled = Array.from({ length: n }, (_, i) => byHole.get(i + 1) ?? { hole: i + 1, par: 4 })
  const course: Course = { id: crypto.randomUUID(), name: c.name, city: c.city, state: c.state, source: c.source, holes: filled, tees, unverified: !complete }
  await env.DB.prepare('INSERT INTO courses (id, name, city, state, source, external_id, holes, tees, unverified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(course.id, course.name, course.city, course.state, course.source, c.externalId, JSON.stringify(course.holes), JSON.stringify(course.tees), course.unverified ? 1 : 0).run()
  return course
}
