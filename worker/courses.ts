import type { Course, CourseCandidate } from '../shared/types'
import { distKm, gcaCandidates, gcaCourse, mergeCandidates, nomCandidates, normName, ogCandidates, ogCourse, osmHoles } from '../shared/courseMap'

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
const OG = 'https://api.opengolfapi.org'

const reach = (name: string) => (e: unknown) => { throw new Error(`${name} isn't responding right now. Try again in a minute.`) }

const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']

/** Tries each public Overpass server in turn; any one answering is enough. */
async function overpass(query: string, ms = 12_000) {
  let last = 'OpenStreetMap lookup failed'
  for (const url of OVERPASS) {
    try {
      const res = await fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': UA }, body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(ms),
      })
      if (res.ok) return (await res.json<{ elements: never[] }>()).elements
      last = `OpenStreetMap lookup failed (${res.status})`
    } catch { last = "OpenStreetMap isn't responding right now. Try again in a minute." }
  }
  throw new Error(last)
}

/** OpenStreetMap's own search service. Answers from Cloudflare where the Overpass servers do not. Keep to one request a second. */
async function nominatim(q: string, at: { lat: number; lon: number }, radiusKm: number) {
  const dLat = radiusKm / 111, dLon = radiusKm / (111 * Math.cos((at.lat * Math.PI) / 180))
  const box = [at.lon - dLon, at.lat + dLat, at.lon + dLon, at.lat - dLat].map((n) => n.toFixed(4)).join(',')
  const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=40&bounded=1&viewbox=${box}&q=${encodeURIComponent(q)}`,
    { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(8_000) }).catch(reach('OpenStreetMap search'))
  if (!res.ok) throw new Error(`OpenStreetMap search failed (${res.status})`)
  return nomCandidates(await res.json<never[]>())
}
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

// GolfCourseAPI's free tier is about 35 requests a day. Keep our own tally and stop a few short of it.
const GCA_BUDGET = 28
const today = () => new Date().toISOString().slice(0, 10)
async function gcaSpend(env: CourseEnv, set?: number) {
  const key = `gca-used:${today()}`
  if (set != null) {
    await env.DB.prepare("INSERT INTO geo_cache (key, value, fetched_at) VALUES (?1, ?2, strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(key) DO UPDATE SET value = ?2, fetched_at = excluded.fetched_at").bind(key, String(set)).run()
    return set
  }
  const row = await env.DB.prepare('SELECT value FROM geo_cache WHERE key = ?').bind(key).first<{ value: string }>()
  return Number(row?.value ?? 0)
}
export const gcaUsed = (env: CourseEnv) => gcaSpend(env)

const gca = async (env: CourseEnv, path: string) => {
  const used = await gcaSpend(env)
  if (used >= GCA_BUDGET) throw new Error('GolfCourseAPI: daily budget used (429)')
  await gcaSpend(env, used + 1)
  const res = await fetch(`${GCA}${path}`, { headers: { authorization: `Bearer ${env.GOLF_COURSE_API_KEY}`, 'user-agent': UA }, signal: AbortSignal.timeout(8_000) }).catch(reach('GolfCourseAPI'))
  if (res.status === 429) await gcaSpend(env, GCA_BUDGET) // their own limit is hit; stop for the day
  if (!res.ok) throw new Error(`GolfCourseAPI lookup failed (${res.status})`)
  return res.json<Record<string, never>>()
}

/** OpenGolfAPI needs no key. Search lives under /v1, the rest under /api/v1, so detail tries both. */
const og = async (paths: string[]) => {
  let last = 'OpenGolfAPI'
  for (const p of paths) {
    try {
      const res = await fetch(`${OG}${p}`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(8_000) })
      if (res.ok) return res.json<Record<string, never>>()
      last = `OpenGolfAPI lookup failed (${res.status})`
    } catch { last = "OpenGolfAPI isn't responding right now." }
  }
  throw new Error(last)
}
const ogRows = (r: Record<string, unknown>) => ((r.courses ?? r.results ?? r.data ?? (Array.isArray(r) ? r : [])) as never[])

export const sources = (env: CourseEnv) => ({ osm: true, golfcourseapi: !!env.GOLF_COURSE_API_KEY, opengolf: true })

const DAY = 86_400_000
/** Read-through cache in D1. Failures are not cached. */
async function cached<T>(env: CourseEnv, key: string, ttlDays: number, load: () => Promise<T>, emptyTtlDays = 0): Promise<T> {
  const isEmpty = (v: unknown) => (Array.isArray(v) ? !v.length : !v)
  const hit = await env.DB.prepare('SELECT value, fetched_at FROM geo_cache WHERE key = ?').bind(key).first<{ value: string; fetched_at: string }>()
  if (hit) {
    const v = JSON.parse(hit.value) as T
    if (Date.now() - Date.parse(hit.fetched_at) < (isEmpty(v) ? emptyTtlDays : ttlDays) * DAY) return v
  }
  const value = await load()
  if (isEmpty(value) && !emptyTtlDays) return value // empty answers are only remembered briefly, if at all
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

/** Merge twins across sources, mark saved ones, attach distance, sort. */
async function finish(env: CourseEnv, cs: CourseCandidate[], at?: { lat: number; lon: number }) {
  const out = mergeCandidates(cs)
  if (out.length) {
    const ids = out.flatMap((c) => [c.externalId, ...(c.alts ?? []).map((a) => a.externalId)])
    const { results } = await env.DB.prepare(`SELECT id, source, external_id FROM courses WHERE external_id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all<{ id: string; source: string; external_id: string }>()
    const saved = new Map(results.map((r) => [`${r.source}:${r.external_id}`, r.id]))
    for (const c of out) { const id = [c, ...(c.alts ?? [])].map((x) => saved.get(`${x.source}:${x.externalId}`)).find(Boolean); if (id) c.savedId = id }
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
      const found: CourseCandidate[] = []
      let failure: Error | null = null
      try { found.push(...ogCandidates(ogRows(await og([`/v1/courses/search?lat=${lat}&lng=${lon}&radius_mi=${Math.round(r / 1.609)}&limit=100`])))) } catch (e) { failure = e as Error }
      for (const term of ['golf course', 'golf club', 'country club']) {
        try { found.push(...(await nominatim(term, { lat, lon }, r))) } catch (e) { failure = e as Error }
        await pause(1100)
      }
      if (!found.length && failure) throw failure
      await remember(env, found)
      return found.length
    })
  } catch (e) { errors.push((e as Error).message) }
  const dLat = r / 111, dLon = r / (111 * Math.cos((lat * Math.PI) / 180))
  const { results } = await env.DB.prepare('SELECT * FROM course_index WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?').bind(lat - dLat, lat + dLat, lon - dLon, lon + dLon)
    .all<{ source: CourseCandidate['source']; external_id: string; name: string; city: string | null; state: string | null; lat: number; lon: number }>()
  const cs: CourseCandidate[] = results.map((x) => ({ source: x.source, externalId: x.external_id, name: x.name, city: x.city, state: x.state, lat: x.lat, lon: x.lon }))
  return { candidates: (await finish(env, cs, { lat, lon })).filter((c) => (c.distanceKm ?? 0) <= r).slice(0, 40), errors }
}

/** Name search: directory first (instant), GolfCourseAPI on top. Matches on any words typed, partial words included. */
export async function findOnline(env: CourseEnv, q: string, at?: { lat: number; lon: number }) {
  const errors: string[] = [], info: string[] = []
  const safe = q.replace(/[^\w ]/g, ' ').replace(/\s+/g, ' ').trim()
  if (safe.length < 3) return { candidates: [] as CourseCandidate[], errors, info }
  const tokens = safe.toLowerCase().split(' ').filter(Boolean)
  const wordsOf = (c: CourseCandidate) => `${c.name} ${c.city ?? ''}`.toLowerCase().split(/[^a-z0-9]+/)
  const matches = (c: CourseCandidate) => tokens.every((t) => wordsOf(c).some((w) => w.startsWith(t)))

  const where = tokens.map(() => 'name LIKE ?').join(' AND ')
  const { results } = await env.DB.prepare(`SELECT * FROM course_index WHERE ${where} LIMIT 20`)
    .bind(...tokens.map((t) => `%${t}%`)).all<{ source: CourseCandidate['source']; external_id: string; name: string; city: string | null; state: string | null; lat: number; lon: number }>()
  const cs: CourseCandidate[] = results.map((x) => ({ source: x.source, externalId: x.external_id, name: x.name, city: x.city, state: x.state, lat: x.lat, lon: x.lon }))
  info.push(`nearby directory: ${cs.length}`)
  try {
    const found = await cached(env, `oq:${safe.toLowerCase()}`, 7, async () => ogCandidates(ogRows(await og([`/v1/courses/search?q=${encodeURIComponent(safe)}&limit=25`]))), 1)
    info.push(`OpenGolfAPI: ${found.length}`)
    cs.push(...found.filter(matches))
    await remember(env, found)
  } catch (e) { info.push(`OpenGolfAPI: ${(e as Error).message}`) }
  info.push('GolfCourseAPI: asked only when you pick a course')
  if (cs.length < 3) {
    try {
      const found = await cached(env, `nq:${safe.toLowerCase()}`, 7, () => nominatim(`${safe} golf`, at ?? { lat: 32.78, lon: -96.8 }, 80), 1)
      info.push(`OpenStreetMap: ${found.length}`)
      cs.push(...found.filter(matches))
      await remember(env, found)
    } catch (e) { info.push(`OpenStreetMap: ${(e as Error).message}`) }
  }
  return { candidates: (await finish(env, cs, at)).slice(0, 30), errors, info }
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
  let refs = [{ source: c.source, externalId: c.externalId }, ...(c.alts ?? [])]
  // A saved course is reused only once its pars are verified. Unverified ones (pars set to 4) are re-fetched below.
  const st: { row: Row | null } = { row: null }
  const lookSaved = async () => {
    for (const r of refs) {
      const existing = await env.DB.prepare('SELECT * FROM courses WHERE source = ? AND external_id = ?').bind(r.source, r.externalId).first<Row>()
      if (existing && !existing.unverified) return toCourse(existing)
      if (existing) st.row ??= existing
    }
    return null
  }
  const saved = await lookSaved()
  if (saved) return saved

  // Picking a course is the only time GolfCourseAPI is asked: find the same course there (and in OpenGolf) by name.
  const needGca = !!env.GOLF_COURSE_API_KEY && !refs.some((r) => r.source === 'golfcourseapi')
  const needOg = !refs.some((r) => r.source === 'opengolf')
  if (needGca || needOg) {
    const term = c.name.replace(/[^\w ]/g, ' ').replace(/\s+/g, ' ').trim()
    const [g, o] = await Promise.all([
      needGca ? cached(env, `q:${term.toLowerCase()}`, 7, async () => gcaCandidates(((await gca(env, `/search?search_query=${encodeURIComponent(term)}`)) as { courses?: never[] }).courses ?? []), 1).catch(() => []) : [],
      needOg ? og([`/v1/courses/search?q=${encodeURIComponent(term)}&limit=10`]).then((r) => ogCandidates(ogRows(r))).catch(() => []) : [],
    ])
    const own = { ...c, alts: c.alts ?? [] }
    const merged = mergeCandidates([own, ...g, ...o]).find((m) => [m, ...(m.alts ?? [])].some((x) => x.source === c.source && x.externalId === c.externalId))
    if (merged) refs = [{ source: merged.source, externalId: merged.externalId }, ...(merged.alts ?? [])]
    const again = await lookSaved()
    if (again) return again
  }

  let holes: Course['holes'] = [], tees: Course['tees'] = [], complete = false, from = c.source
  const fromGca = async (id: string) => {
    const detail = (await gca(env, `/courses/${encodeURIComponent(id)}`)) as never
    return gcaCourse(((detail as { course?: never }).course ?? detail) as Parameters<typeof gcaCourse>[0])
  }
  const fromOg = async (id: string) => {
    const i = encodeURIComponent(id)
    const detail = (await og([`/api/v1/courses/${i}`, `/v1/courses/${i}`])) as Record<string, unknown>
    const d = ((detail.course ?? detail) as Record<string, unknown>)
    // Tees and holes may be thin on the detail call; their own endpoints fill the gaps.
    const [t, h] = await Promise.all([
      (Array.isArray(d.tees) && d.tees.length ? Promise.resolve(null) : og([`/api/v1/courses/${i}/tees`, `/v1/courses/${i}/tees`]).catch(() => null)),
      (Array.isArray(d.holes) && d.holes.length ? Promise.resolve(null) : og([`/api/v1/courses/${i}/holes`, `/v1/courses/${i}/holes`]).catch(() => null)),
    ])
    return ogCourse({ ...d, ...(t ? { tees: (t as Record<string, unknown>).tees ?? t } : {}), ...(h ? { holes: (h as Record<string, unknown>).holes ?? h } : {}) })
  }
  // Most detailed source first. A partial answer is kept only if nothing later does better.
  const rank = { golfcourseapi: 3, opengolf: 2, osm: 1 } as Record<string, number>
  for (const r of [...refs].sort((x, y) => (rank[y.source] ?? 0) - (rank[x.source] ?? 0))) {
    try {
      let got: { holes: Course['holes']; tees: Course['tees']; complete: boolean } | null = null
      if (r.source === 'golfcourseapi') got = env.GOLF_COURSE_API_KEY ? await fromGca(r.externalId) : null
      else if (r.source === 'opengolf') got = await fromOg(r.externalId)
      else {
        const [type, id] = r.externalId.split('/')
        if (!['way', 'relation', 'node'].includes(type) || !/^\d+$/.test(id)) throw new Error('Unknown course')
        if (type !== 'node') got = { tees: [], ...osmHoles(await overpass(`[out:json][timeout:25];${type}(${id});map_to_area->.a;way["golf"="hole"](area.a);out tags;`, 8_000)) }
      }
      if (!got) continue
      const better = got.complete || (!complete && got.holes.length > holes.length) || (!tees.length && got.tees.length && !complete)
      if (better) { holes = got.holes; tees = got.tees.length ? got.tees : tees; complete = got.complete; from = r.source as typeof c.source }
      if (got.complete && got.tees.length) break
    } catch { /* try the next source */ }
  }
  c = { ...c, source: from, externalId: refs.find((r) => r.source === from)?.externalId ?? c.externalId }
  // Fill any missing holes with par 4 so the course is usable; it is flagged so the pars get checked.
  const n = complete && holes.length === 9 ? 9 : 18 // 18 unless a source confirms a full 9-hole card
  const byHole = new Map(holes.map((h) => [h.hole, h]))
  const filled = Array.from({ length: n }, (_, i) => byHole.get(i + 1) ?? { hole: i + 1, par: 4 })
  const stale = st.row
  if (stale) {
    // Re-fetch of an unverified save: replace its card only if we now have a complete one.
    if (!complete) return toCourse(stale)
    await env.DB.prepare('UPDATE courses SET holes = ?, tees = ?, unverified = 0 WHERE id = ?').bind(JSON.stringify(filled), JSON.stringify(tees), stale.id).run()
    return { ...toCourse(stale), holes: filled, tees, unverified: false }
  }
  const course: Course = { id: crypto.randomUUID(), name: c.name, city: c.city, state: c.state, source: c.source, holes: filled, tees, unverified: !complete }
  await env.DB.prepare('INSERT INTO courses (id, name, city, state, source, external_id, holes, tees, unverified, lat, lon) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(course.id, course.name, course.city, course.state, course.source, c.externalId, JSON.stringify(course.holes), JSON.stringify(course.tees), course.unverified ? 1 : 0, c.lat ?? null, c.lon ?? null).run()
  return course
}

/** Raw responses from each source, for debugging. Never includes the key. */
export async function diagnose(env: CourseEnv, q: string, detail = '', useGca = false) {
  const probe = async (label: string, url: string, init: RequestInit) => {
    const t = Date.now()
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(8_000) })
      const raw = await res.text()
      const body = (raw.trimStart().startsWith('<') ? `${raw.match(/<title>([^<]*)/i)?.[1] ?? ''} ${raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')}` : raw).slice(0, 400)
      return { label, status: res.status, ms: Date.now() - t, body }
    } catch (e) { return { label, error: (e as Error).message, ms: Date.now() - t } }
  }
  const name = (q || 'pecan').replace(/[^\w ]/g, '')
  const term = encodeURIComponent(name)
  const query = `[out:json][timeout:20];nwr["leisure"="golf_course"]["name"~"${name}",i](32.0,-98.0,33.6,-96.0);out tags center 5;`
  if (detail && env.GOLF_COURSE_API_KEY) {
    // One GolfCourseAPI course card, to see what the hole and tee data looks like.
    const id = encodeURIComponent(detail.replace(/[^\w-]/g, ''))
    const res = await fetch(`${GCA}/courses/${id}`, { headers: { authorization: `Bearer ${env.GOLF_COURSE_API_KEY}`, 'user-agent': UA }, signal: AbortSignal.timeout(8_000) }).catch(() => null)
    const body = res ? await res.text() : ''
    let parsed: unknown = null
    try { const j = JSON.parse(body); parsed = gcaCourse((j.course ?? j) as never) } catch { /* not JSON */ }
    await gcaSpend(env, (await gcaSpend(env)) + 1)
    return { status: res?.status ?? 'no response', parsed, body: body.slice(0, 2500), gcaUsedToday: await gcaSpend(env), budget: GCA_BUDGET }
  }
  if (useGca && env.GOLF_COURSE_API_KEY) await gcaSpend(env, (await gcaSpend(env)) + 1)
  return Promise.all([
    env.GOLF_COURSE_API_KEY && useGca
      ? probe('golfcourseapi search', `${GCA}/search?search_query=${term}`, { headers: { authorization: `Bearer ${env.GOLF_COURSE_API_KEY}`, 'user-agent': UA } })
      : Promise.resolve({ label: 'golfcourseapi search', error: env.GOLF_COURSE_API_KEY ? 'skipped to save the daily quota. Add &gca=1 to test it' : 'no key set' }),
    probe('opengolfapi near plano', `${OG}/v1/courses/search?lat=33.02&lng=-96.70&radius_mi=25&limit=50`, { headers: { 'user-agent': UA } }),
    probe('opengolfapi name', `${OG}/v1/courses/search?q=${term}&limit=5`, { headers: { 'user-agent': UA } }),
    probe('nominatim', `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=5&bounded=1&viewbox=-98.0,33.6,-96.0,32.0&q=${term}%20golf`, { headers: { 'user-agent': UA } }),
    ...OVERPASS.map((url) => probe(`overpass ${new URL(url).host}`, url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': UA }, body: `data=${encodeURIComponent(query)}` })),
  ])
}
