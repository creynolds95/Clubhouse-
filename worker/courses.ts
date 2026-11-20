import type { Course, CourseCandidate } from '../shared/types'
import { distKm, gcaCandidates, gcaCourse, normName, osmCandidates, osmHoles } from '../shared/courseMap'

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

const reach = (name: string) => (e: unknown) => { throw new Error(`${name} isn't responding right now. Try again in a minute.`) }

const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']

/** Tries each public Overpass server in turn; any one answering is enough. */
async function overpass(query: string) {
  let last = 'OpenStreetMap lookup failed'
  for (const url of OVERPASS) {
    try {
      const res = await fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': UA }, body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(12_000),
      })
      if (res.ok) return (await res.json<{ elements: never[] }>()).elements
      last = `OpenStreetMap lookup failed (${res.status})`
    } catch { last = "OpenStreetMap isn't responding right now. Try again in a minute." }
  }
  throw new Error(last)
}

const gca = async (env: CourseEnv, path: string) => {
  const res = await fetch(`${GCA}${path}`, { headers: { authorization: `Bearer ${env.GOLF_COURSE_API_KEY}`, 'user-agent': UA }, signal: AbortSignal.timeout(8_000) }).catch(reach('GolfCourseAPI'))
  if (!res.ok) throw new Error(`GolfCourseAPI lookup failed (${res.status})`)
  return res.json<Record<string, never>>()
}

export const sources = (env: CourseEnv) => ({ osm: true, golfcourseapi: !!env.GOLF_COURSE_API_KEY })

const DAY = 86_400_000
/** Read-through cache in D1. Failures are not cached. */
async function cached<T>(env: CourseEnv, key: string, ttlDays: number, load: () => Promise<T>): Promise<T> {
  const hit = await env.DB.prepare('SELECT value, fetched_at FROM geo_cache WHERE key = ?').bind(key).first<{ value: string; fetched_at: string }>()
  if (hit && Date.now() - Date.parse(hit.fetched_at) < ttlDays * DAY) return JSON.parse(hit.value) as T
  const value = await load()
  await env.DB.prepare("INSERT INTO geo_cache (key, value, fetched_at) VALUES (?1, ?2, strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(key) DO UPDATE SET value = ?2, fetched_at = excluded.fetched_at")
    .bind(key, JSON.stringify(value)).run()
  return value
}

async function remember(env: CourseEnv, cs: CourseCandidate[]) {
  const withPos = cs.filter((c) => c.lat != null && c.lon != null)
  if (!withPos.length) return
  await env.DB.batch(withPos.map((c) => env.DB.prepare('INSERT OR REPLACE INTO course_index (source, external_id, name, city, state, lat, lon) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(c.source, c.externalId, c.name, c.city, c.state, c.lat, c.lon)))
}

/** Mark saved ones, attach distance, sort. A GolfCourseAPI entry hides an OpenStreetMap twin of the same name, since it carries pars. */
async function finish(env: CourseEnv, cs: CourseCandidate[], at?: { lat: number; lon: number }) {
  const gcaNames = new Set(cs.filter((c) => c.source === 'golfcourseapi').map((c) => normName(c.name)))
  const out = cs.filter((c) => c.source === 'golfcourseapi' || !gcaNames.has(normName(c.name)))
  if (out.length) {
    const { results } = await env.DB.prepare(`SELECT id, source, external_id FROM courses WHERE external_id IN (${out.map(() => '?').join(',')})`).bind(...out.map((c) => c.externalId)).all<{ id: string; source: string; external_id: string }>()
    const saved = new Map(results.map((r) => [`${r.source}:${r.external_id}`, r.id]))
    for (const c of out) { const id = saved.get(`${c.source}:${c.externalId}`); if (id) c.savedId = id }
  }
  if (at) for (const c of out) if (c.lat != null && c.lon != null) c.distanceKm = Math.round(distKm(at.lat, at.lon, c.lat, c.lon) * 10) / 10
  return out.sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9) || a.name.localeCompare(b.name))
}

/** Courses around a point. One OpenStreetMap request per ~10 km cell per 30 days, then served from D1. */
export async function near(env: CourseEnv, lat: number, lon: number, radiusKm = 40) {
  const r = Math.min(80, Math.max(5, radiusKm))
  const key = `area:${lat.toFixed(1)},${lon.toFixed(1)}:${r}`
  const errors: string[] = []
  try {
    await cached(env, key, 30, async () => {
      await remember(env, osmCandidates(await overpass(`[out:json][timeout:25];nwr["leisure"="golf_course"]["name"](around:${r * 1000},${lat},${lon});out tags center 150;`)))
      return 1
    })
  } catch (e) { errors.push((e as Error).message) }
  const dLat = r / 111, dLon = r / (111 * Math.cos((lat * Math.PI) / 180))
  const { results } = await env.DB.prepare('SELECT * FROM course_index WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?').bind(lat - dLat, lat + dLat, lon - dLon, lon + dLon)
    .all<{ source: CourseCandidate['source']; external_id: string; name: string; city: string | null; state: string | null; lat: number; lon: number }>()
  const cs: CourseCandidate[] = results.map((x) => ({ source: x.source, externalId: x.external_id, name: x.name, city: x.city, state: x.state, lat: x.lat, lon: x.lon }))
  return { candidates: (await finish(env, cs, { lat, lon })).filter((c) => (c.distanceKm ?? 0) <= r).slice(0, 40), errors }
}

/** Name search: directory first (instant), GolfCourseAPI on top (cached a week). */
export async function findOnline(env: CourseEnv, q: string, at?: { lat: number; lon: number }) {
  const errors: string[] = []
  const safe = q.replace(/[^\w ]/g, '').trim()
  if (safe.length < 3) return { candidates: [] as CourseCandidate[], errors }
  const like = `%${safe.replace(/ /g, '%')}%`
  const { results } = await env.DB.prepare('SELECT * FROM course_index WHERE name LIKE ? LIMIT 20')
    .bind(like).all<{ source: CourseCandidate['source']; external_id: string; name: string; city: string | null; state: string | null; lat: number; lon: number }>()
  const cs: CourseCandidate[] = results.map((x) => ({ source: x.source, externalId: x.external_id, name: x.name, city: x.city, state: x.state, lat: x.lat, lon: x.lon }))
  if (env.GOLF_COURSE_API_KEY) {
    try {
      const found = await cached(env, `q:${safe.toLowerCase()}`, 7, async () =>
        gcaCandidates(((await gca(env, `/search?search_query=${encodeURIComponent(safe)}`)) as { courses?: never[] }).courses ?? []))
      cs.push(...found)
      await remember(env, found)
    } catch (e) { errors.push((e as Error).message) }
  }
  return { candidates: (await finish(env, cs, at)).slice(0, 30), errors }
}

/** Turn a ZIP or city into a point. */
export async function geocode(env: CourseEnv, q: string) {
  const s = q.trim().slice(0, 80)
  if (!s) throw new Error('Enter a ZIP or city')
  return cached(env, `geo:${s.toLowerCase()}`, 90, async () => {
    if (/^\d{5}$/.test(s)) {
      const res = await fetch(`https://api.zippopotam.us/us/${s}`, { signal: AbortSignal.timeout(6_000) }).catch(reach('The ZIP lookup'))
      if (!res.ok) throw new Error(`No match for ZIP ${s}`)
      const p = (await res.json<{ places: { 'place name': string; 'state abbreviation': string; latitude: string; longitude: string }[] }>()).places[0]
      return { label: `${p['place name']}, ${p['state abbreviation']}`, lat: Number(p.latitude), lon: Number(p.longitude) }
    }
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(s)}`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(6_000) }).catch(reach('The place lookup'))
    const hit = (await res.json<{ lat: string; lon: string; display_name: string }[]>())[0]
    if (!res.ok || !hit) throw new Error(`Couldn't find “${s}”`)
    return { label: hit.display_name.split(',').slice(0, 2).join(',').trim(), lat: Number(hit.lat), lon: Number(hit.lon) }
  })
}

export async function importCourse(env: CourseEnv, c: CourseCandidate): Promise<Course> {
  const existing = await env.DB.prepare('SELECT * FROM courses WHERE source = ? AND external_id = ?').bind(c.source, c.externalId).first<Row>()
  if (existing) return toCourse(existing)

  let holes: Course['holes'] = [], tees: Course['tees'] = [], complete = false
  const fromGca = async (id: string) => {
    const detail = (await gca(env, `/courses/${encodeURIComponent(id)}`)) as never
    return gcaCourse(((detail as { course?: never }).course ?? detail) as Parameters<typeof gcaCourse>[0])
  }
  if (c.source === 'golfcourseapi') {
    ;({ holes, tees, complete } = await fromGca(c.externalId))
  } else {
    const [type, id] = c.externalId.split('/')
    if (!['way', 'relation'].includes(type) || !/^\d+$/.test(id)) throw new Error('Unknown course')
    ;({ holes, complete } = osmHoles(await overpass(`[out:json][timeout:25];${type}(${id});map_to_area->.a;way["golf"="hole"](area.a);out tags;`)))
    // OpenStreetMap pars are patchy. If GolfCourseAPI lists the same course nearby, use its card instead.
    if (!complete && env.GOLF_COURSE_API_KEY) {
      try {
        const twins = gcaCandidates(((await gca(env, `/search?search_query=${encodeURIComponent(c.name.replace(/[^\w ]/g, ' ').trim())}`)) as { courses?: never[] }).courses ?? [])
        const want = normName(c.name)
        const twin = twins.find((t) => normName(t.name) === want || normName(t.name).includes(want) || want.includes(normName(t.name)))
        if (twin) { const g = await fromGca(twin.externalId); if (g.complete) ({ holes, tees, complete } = g) }
      } catch { /* keep the OpenStreetMap result */ }
    }
  }
  // Fill any missing holes with par 4 so the course is usable; it is flagged so the pars get checked.
  const n = holes.length > 9 ? 18 : 9
  const byHole = new Map(holes.map((h) => [h.hole, h]))
  const filled = Array.from({ length: n }, (_, i) => byHole.get(i + 1) ?? { hole: i + 1, par: 4 })
  const course: Course = { id: crypto.randomUUID(), name: c.name, city: c.city, state: c.state, source: c.source, holes: filled, tees, unverified: !complete }
  await env.DB.prepare('INSERT INTO courses (id, name, city, state, source, external_id, holes, tees, unverified, lat, lon) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(course.id, course.name, course.city, course.state, course.source, c.externalId, JSON.stringify(course.holes), JSON.stringify(course.tees), course.unverified ? 1 : 0, c.lat ?? null, c.lon ?? null).run()
  return course
}
