import { Hono } from 'hono'
import type { R10Shot, Round, Swing, SwingPhase } from '../shared/types'
import { PHASES } from '../shared/types'
import { aiStatus, getCoach, CoachOffError, type AiEnv } from './ai'
import { diagnose, findOnline, geocode, importCourse, near, sources, toCourse, type CourseEnv } from './courses'
import type { Course, CourseCandidate, Profile } from '../shared/types'
import { bumpRequests, purgeExpired, r2HasRoom, setRetentionDays, usageReport } from './maintenance'
import { logReport } from './outbound'
import { GCA_BUDGET, gcaUsedToday } from './courses'

type Env = AiEnv & CourseEnv & { DB: D1Database; MEDIA: R2Bucket; ASSETS: Fetcher }
const app = new Hono<{ Bindings: Env }>().basePath('/api')

// Count API requests per day for the usage readout (static files are free and not counted).
app.use('*', async (c, next) => { c.executionCtx.waitUntil(bumpRequests(c.env).catch(() => {})); await next() })

// Auth: meant to sit behind Cloudflare Access (single user). Until Access is turned on the API is public,
// so uploads are size-capped and refused when storage nears the free limit.

const MAX_VIDEO_BYTES = 95 * 1024 * 1024 // Workers free plan request body cap is 100 MB
const MAX_FRAME_BYTES = 2 * 1024 * 1024

type SwingRow = {
  id: string; created_at: string; taken_at: string | null; club: string | null; view: string | null
  note: string | null; video_key: string | null; frames: string; metrics: string | null; feedback: string | null; r10_shot_id: string | null
}
const toSwing = (r: SwingRow): Swing => ({
  id: r.id, createdAt: r.created_at, takenAt: r.taken_at, club: r.club, view: r.view as Swing['view'],
  note: r.note, hasVideo: !!r.video_key, frames: JSON.parse(r.frames),
  metrics: r.metrics ? JSON.parse(r.metrics) : null, feedback: r.feedback, r10ShotId: r.r10_shot_id,
})
const isPhase = (p: string): p is SwingPhase => (PHASES as string[]).includes(p)
const swingExists = async (env: Env, id: string) => !!(await env.DB.prepare('SELECT 1 FROM swings WHERE id = ?').bind(id).first())
const FULL = 'File storage is nearly at the free limit. Clean up old videos in Settings first.'

app.get('/health', (c) => c.json({ ok: true }))

// ---- Swings ----
app.get('/swings', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM swings ORDER BY created_at DESC LIMIT 100').all<SwingRow>()
  return c.json(results.map(toSwing))
})

app.get('/swings/:id', async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM swings WHERE id = ?').bind(c.req.param('id')).first<SwingRow>()
  return row ? c.json(toSwing(row)) : c.json({ error: 'Swing not found' }, 404)
})

app.post('/swings', async (c) => {
  const body = await c.req.json<{ club?: string; view?: string; takenAt?: string; note?: string }>()
  const id = crypto.randomUUID()
  await c.env.DB.prepare('INSERT INTO swings (id, club, view, taken_at, note) VALUES (?, ?, ?, ?, ?)')
    .bind(id, body.club ?? null, body.view ?? null, body.takenAt ?? null, body.note ?? null).run()
  return c.json({ id }, 201)
})

// Tag a swing to an R10 shot (or clear the tag). One swing per shot.
app.put('/swings/:id/link', async (c) => {
  const { r10ShotId } = await c.req.json<{ r10ShotId: string | null }>()
  if (r10ShotId) {
    const shot = await c.env.DB.prepare('SELECT id FROM r10_shots WHERE id = ?').bind(r10ShotId).first()
    if (!shot) return c.json({ error: 'Shot not found' }, 404)
    await c.env.DB.prepare('UPDATE swings SET r10_shot_id = NULL WHERE r10_shot_id = ?').bind(r10ShotId).run()
  }
  await c.env.DB.prepare('UPDATE swings SET r10_shot_id = ? WHERE id = ?').bind(r10ShotId ?? null, c.req.param('id')).run()
  return c.body(null, 204)
})

app.put('/swings/:id/video', async (c) => {
  const id = c.req.param('id')
  const len = Number(c.req.header('content-length') ?? 0)
  if (!len || len > MAX_VIDEO_BYTES) return c.json({ error: 'Video must be under 95 MB' }, 413)
  if (!(await swingExists(c.env, id))) return c.json({ error: 'Swing not found' }, 404)
  if (!(await r2HasRoom(c.env, len))) return c.json({ error: FULL }, 507)
  const key = `swings/${id}/video`
  await c.env.MEDIA.put(key, c.req.raw.body!, { httpMetadata: { contentType: c.req.header('content-type') ?? 'video/mp4' } })
  await c.env.DB.prepare('UPDATE swings SET video_key = ? WHERE id = ?').bind(key, id).run()
  return c.body(null, 204)
})

app.put('/swings/:id/frames/:phase', async (c) => {
  const { id, phase } = c.req.param()
  if (!isPhase(phase)) return c.json({ error: 'Unknown phase' }, 400)
  const buf = await c.req.arrayBuffer()
  if (!buf.byteLength || buf.byteLength > MAX_FRAME_BYTES) return c.json({ error: 'Frame is empty or too large' }, 413)
  if (!(await swingExists(c.env, id))) return c.json({ error: 'Swing not found' }, 404)
  await c.env.MEDIA.put(`swings/${id}/frames/${phase}.jpg`, buf, { httpMetadata: { contentType: 'image/jpeg' } })
  await c.env.DB.prepare(
    `UPDATE swings SET frames = (SELECT json_group_array(value) FROM (SELECT DISTINCT value FROM json_each(json_insert(frames, '$[#]', ?)))) WHERE id = ?`,
  ).bind(phase, id).run()
  return c.body(null, 204)
})

app.put('/swings/:id/metrics', async (c) => {
  const metrics = await c.req.json()
  await c.env.DB.prepare('UPDATE swings SET metrics = ? WHERE id = ?').bind(JSON.stringify(metrics), c.req.param('id')).run()
  return c.body(null, 204)
})

// Cached hard on the device. Frames are rewritten by "Read swing again", so the app adds ?v=<version> to their URLs.
const serveMedia = async (c: { env: Env }, key: string, range?: string) => {
  const obj = await c.env.MEDIA.get(key, range ? { range: parseRange(range) } : undefined)
  if (!obj) return new Response('Not found', { status: 404 })
  const h = new Headers()
  obj.writeHttpMetadata(h)
  h.set('cache-control', 'private, max-age=31536000, immutable')
  h.set('accept-ranges', 'bytes')
  if (range && obj.range) {
    const r = obj.range as { offset?: number; length?: number; suffix?: number }
    const start = r.suffix != null ? Math.max(0, obj.size - r.suffix) : r.offset ?? 0
    const end = r.suffix != null ? obj.size - 1 : Math.min(obj.size, start + (r.length ?? obj.size - start)) - 1
    h.set('content-range', `bytes ${start}-${end}/${obj.size}`)
    return new Response(obj.body, { status: 206, headers: h })
  }
  return new Response(obj.body, { headers: h })
}
const parseRange = (r: string): R2Range | undefined => {
  const m = /bytes=(\d*)-(\d*)/.exec(r)
  if (!m) return undefined
  if (m[1] === '') return { suffix: Number(m[2]) }
  return m[2] === '' ? { offset: Number(m[1]) } : { offset: Number(m[1]), length: Number(m[2]) - Number(m[1]) + 1 }
}

app.get('/swings/:id/video', (c) => serveMedia(c, `swings/${c.req.param('id')}/video`, c.req.header('range')))
app.get('/swings/:id/frames/:phase', async (c) => {
  const { id, phase } = c.req.param()
  if (!isPhase(phase)) return c.json({ error: 'Unknown phase' }, 400)
  return serveMedia(c, `swings/${id}/frames/${phase}.jpg`)
})

app.delete('/swings/:id', async (c) => {
  const id = c.req.param('id')
  const listed = await c.env.MEDIA.list({ prefix: `swings/${id}/` })
  if (listed.objects.length) await c.env.MEDIA.delete(listed.objects.map((o) => o.key))
  await c.env.DB.prepare('DELETE FROM swings WHERE id = ?').bind(id).run()
  return c.body(null, 204)
})

// ---- Rounds ----
type RoundRow = { id: string; played_on: string; course: string; tees: string | null; holes: string; total: number; source: string }
const toRound = (r: RoundRow): Round => ({
  id: r.id, playedOn: r.played_on, course: r.course, tees: r.tees, holes: JSON.parse(r.holes), total: r.total,
  source: r.source as Round['source'],
})

app.get('/rounds', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM rounds ORDER BY played_on DESC LIMIT 200').all<RoundRow>()
  return c.json(results.map(toRound))
})

app.post('/rounds', async (c) => {
  const r = await c.req.json<Omit<Round, 'id' | 'total'> & { externalId?: string }>()
  if (!r.playedOn || !r.course || !Array.isArray(r.holes) || r.holes.length === 0)
    return c.json({ error: 'Round needs a date, a course and at least one hole' }, 400)
  const id = crypto.randomUUID()
  const total = r.holes.reduce((s, h) => s + (h.strokes || 0), 0)
  await c.env.DB.prepare(
    'INSERT INTO rounds (id, played_on, course, tees, holes, total, source, external_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(external_id) DO NOTHING',
  ).bind(id, r.playedOn, r.course, r.tees ?? null, JSON.stringify(r.holes), total, r.source ?? 'manual', r.externalId ?? null).run()
  // A resend of a round already saved (offline outbox) returns the id it was saved under.
  const saved = r.externalId ? await c.env.DB.prepare('SELECT id FROM rounds WHERE external_id = ?').bind(r.externalId).first<{ id: string }>() : null
  return c.json({ id: saved?.id ?? id, total }, 201)
})

app.delete('/rounds/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM rounds WHERE id = ?').bind(c.req.param('id')).run()
  return c.body(null, 204)
})

// ---- Imports (raw files are always kept in R2 so parsers can be rerun later) ----
const MAX_IMPORT_BYTES = 50 * 1024 * 1024
app.post('/imports', async (c) => {
  const kind = c.req.query('kind') ?? 'other'
  const name = (c.req.query('name') ?? 'upload').replace(/[^\w.\- ]/g, '_').slice(0, 120)
  const len = Number(c.req.header('content-length') ?? 0)
  if (!len || len > MAX_IMPORT_BYTES) return c.json({ error: 'File must be under 50 MB' }, 413)
  if (!(await r2HasRoom(c.env, len))) return c.json({ error: FULL }, 507)
  const id = crypto.randomUUID()
  const key = `imports/${id}/${name}`
  await c.env.MEDIA.put(key, c.req.raw.body!, { httpMetadata: { contentType: c.req.header('content-type') ?? 'application/octet-stream' } })
  await c.env.DB.prepare('INSERT INTO imports (id, kind, filename, r2_key) VALUES (?, ?, ?, ?)').bind(id, kind, name, key).run()
  return c.json({ id }, 201)
})

app.get('/imports', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT id, created_at, kind, filename, rows_imported FROM imports ORDER BY created_at DESC LIMIT 50').all()
  return c.json(results)
})

// ---- R10 shots ----
app.post('/r10/shots', async (c) => {
  const { importId, shots } = await c.req.json<{ importId?: string; shots: R10Shot[] }>()
  if (!Array.isArray(shots) || !shots.length) return c.json({ error: 'No shots to import' }, 400)
  if (shots.length > 5000) return c.json({ error: 'Too many shots in one file' }, 413)
  const stmt = c.env.DB.prepare(
    'INSERT OR IGNORE INTO r10_shots (id, import_id, session_date, hit_at, club, metrics, dedupe_key) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
  const batch = shots.map((s) =>
    stmt.bind(crypto.randomUUID(), importId ?? null, s.sessionDate, s.hitAt, s.club, JSON.stringify(s.m),
      [s.hitAt ?? `${s.sessionDate}#${s.m.ballSpeed ?? ''}/${s.m.carry ?? ''}`, (s.club ?? '').toLowerCase()].join('|')))
  let added = 0
  for (let i = 0; i < batch.length; i += 50) {
    const res = await c.env.DB.batch(batch.slice(i, i + 50))
    added += res.reduce((n, r) => n + (r.meta.changes ?? 0), 0)
  }
  if (importId) await c.env.DB.prepare('UPDATE imports SET rows_imported = ? WHERE id = ?').bind(added, importId).run()
  return c.json({ added, duplicates: shots.length - added }, 201)
})

app.get('/r10/shots', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, session_date, hit_at, club, metrics, (SELECT w.id FROM swings w WHERE w.r10_shot_id = r10_shots.id LIMIT 1) AS swing_id FROM r10_shots ORDER BY session_date DESC, hit_at ASC LIMIT 20000',
  ).all<{ id: string; session_date: string; hit_at: string | null; club: string | null; metrics: string; swing_id: string | null }>()
  const shots: R10Shot[] = results.map((r) => ({ id: r.id, sessionDate: r.session_date, hitAt: r.hit_at, club: r.club, m: JSON.parse(r.metrics), ...(r.swing_id ? { swingId: r.swing_id } : {}) }))
  return c.json(shots)
})

app.delete('/r10/sessions/:date', async (c) => {
  await c.env.DB.prepare('DELETE FROM r10_shots WHERE session_date = ?').bind(c.req.param('date')).run()
  return c.body(null, 204)
})

// ---- Courses ----
const validHoles = (h: unknown): h is Course['holes'] =>
  Array.isArray(h) && (h.length === 9 || h.length === 18) && h.every((x, i) => x && x.hole === i + 1 && Number.isInteger(x.par) && x.par >= 3 && x.par <= 6)

app.get('/courses', async (c) => {
  const q = (c.req.query('q') ?? '').trim()
  const { results } = await c.env.DB.prepare('SELECT * FROM courses WHERE name LIKE ? ORDER BY name COLLATE NOCASE LIMIT 50').bind(`%${q}%`).all<never>()
  return c.json((results as never[]).map(toCourse))
})
app.get('/courses/sources', (c) => c.json(sources(c.env)))
const point = (c: { req: { query: (k: string) => string | undefined } }) => {
  const lat = Number(c.req.query('lat')), lon = Number(c.req.query('lon'))
  return Number.isFinite(lat) && Number.isFinite(lon) && c.req.query('lat') ? { lat, lon } : undefined
}
app.get('/courses/find', async (c) => c.json(await findOnline(c.env, c.req.query('q') ?? '', point(c))))
app.get('/courses/diagnose', async (c) => c.text(JSON.stringify(await diagnose(c.env, c.req.query('q') ?? '', c.req.query('detail') ?? '', c.req.query('gca') === '1'), null, 2)))
app.get('/courses/near', async (c) => {
  const at = point(c)
  if (!at) return c.json({ error: 'lat and lon required' }, 400)
  return c.json(await near(c.env, at.lat, at.lon, Number(c.req.query('r')) || 40))
})
app.get('/courses/geocode', async (c) => {
  try { return c.json(await geocode(c.env, c.req.query('q') ?? '')) }
  catch (e) { return c.json({ error: (e as Error).message }, 404) }
})
app.post('/courses/:id/refresh', async (c) => {
  const r = await c.env.DB.prepare('SELECT * FROM courses WHERE id = ?').bind(c.req.param('id')).first<{ source: string; external_id: string | null; name: string; city: string | null; state: string | null; lat: number | null; lon: number | null }>()
  if (!r) return c.json({ error: 'Not found' }, 404)
  if (r.source === 'manual' || !r.external_id) return c.json(toCourse(await c.env.DB.prepare('SELECT * FROM courses WHERE id = ?').bind(c.req.param('id')).first() as never))
  try { return c.json(await importCourse(c.env, { source: r.source as CourseCandidate['source'], externalId: r.external_id, name: r.name, city: r.city, state: r.state, ...(r.lat != null && r.lon != null ? { lat: r.lat, lon: r.lon } : {}) })) }
  catch (e) { return c.json({ error: (e as Error).message }, 502) }
})
app.post('/courses/import', async (c) => {
  try { return c.json(await importCourse(c.env, await c.req.json<CourseCandidate>()), 201) }
  catch (e) { return c.json({ error: (e as Error).message }, 502) }
})
app.post('/courses', async (c) => {
  const b = await c.req.json<Pick<Course, 'name' | 'city' | 'state' | 'holes' | 'tees'>>()
  if (!b.name?.trim() || !validHoles(b.holes)) return c.json({ error: 'A course needs a name and pars for 9 or 18 holes' }, 400)
  const id = crypto.randomUUID()
  await c.env.DB.prepare('INSERT INTO courses (id, name, city, state, source, holes, tees) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, b.name.trim(), b.city ?? null, b.state ?? null, 'manual', JSON.stringify(b.holes), JSON.stringify(b.tees ?? [])).run()
  return c.json({ id }, 201)
})
app.put('/courses/:id', async (c) => {
  const b = await c.req.json<Pick<Course, 'name' | 'city' | 'state' | 'holes' | 'tees'>>()
  if (!b.name?.trim() || !validHoles(b.holes)) return c.json({ error: 'A course needs a name and pars for 9 or 18 holes' }, 400)
  await c.env.DB.prepare('UPDATE courses SET name = ?, city = ?, state = ?, holes = ?, tees = ?, unverified = 0 WHERE id = ?')
    .bind(b.name.trim(), b.city ?? null, b.state ?? null, JSON.stringify(b.holes), JSON.stringify(b.tees ?? []), c.req.param('id')).run()
  return c.body(null, 204)
})
// ---- Scorecard photos (kept so the card can be re-checked; reading them needs the AI step) ----
const cardKey = (id: string, tee: string) => `scorecards/${id}/${(tee || 'card').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30)}.jpg`
app.put('/courses/:id/scorecard', async (c) => {
  const buf = await c.req.arrayBuffer()
  if (!buf.byteLength || buf.byteLength > 8_000_000) return c.json({ error: 'Photo is empty or over 8 MB' }, 400)
  if (!(await c.env.DB.prepare('SELECT 1 FROM courses WHERE id = ?').bind(c.req.param('id')).first())) return c.json({ error: 'Course not found' }, 404)
  if (!(await r2HasRoom(c.env, buf.byteLength))) return c.json({ error: FULL }, 507)
  await c.env.MEDIA.put(cardKey(c.req.param('id'), c.req.query('tee') ?? ''), buf, { httpMetadata: { contentType: 'image/jpeg' } })
  return c.body(null, 204)
})
app.get('/courses/:id/scorecard', async (c) => {
  const obj = await c.env.MEDIA.get(cardKey(c.req.param('id'), c.req.query('tee') ?? ''))
  if (!obj) return c.json({ error: 'No photo' }, 404)
  return new Response(obj.body, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=3600' } })
})
app.post('/courses/:id/scorecard/read', (c) => {
  if (!aiStatus(c.env).enabled) return c.json({ error: 'Reading a scorecard photo turns on with the AI coach. Enter the numbers by hand for now.' }, 503)
  return c.json({ error: 'Not implemented' }, 501)
})
app.delete('/courses/:id', async (c) => {
  const id = c.req.param('id')
  const photos = await c.env.MEDIA.list({ prefix: `scorecards/${id}/` })
  if (photos.objects.length) await c.env.MEDIA.delete(photos.objects.map((o) => o.key))
  await c.env.DB.prepare('DELETE FROM courses WHERE id = ?').bind(id).run()
  return c.body(null, 204)
})

// ---- Retention + usage ----
app.get('/usage', async (c) => c.json(await usageReport(c.env)))
app.put('/settings/retention', async (c) => {
  const { days } = await c.req.json<{ days: number }>()
  if (!Number.isInteger(days) || days < 1 || days > 90) return c.json({ error: 'Choose 1 to 90 days' }, 400)
  await setRetentionDays(c.env, days)
  return c.body(null, 204)
})
app.post('/maintenance/purge', async (c) => c.json(await purgeExpired(c.env)))

// ---- Outside services: every outbound call, cache hit and skipped call ----
app.get('/log', async (c) => c.json({
  ...(await logReport(c.env, Number(c.req.query('limit')) || 150)),
  golfCourseApi: { usedToday: await gcaUsedToday(c.env), budget: GCA_BUDGET, keySet: !!c.env.GOLF_COURSE_API_KEY },
}))

// ---- Player profile (plain JSON in app_settings; read by the coach) ----
const num = (v: unknown, min: number, max: number) => { const n = Number(v); return v != null && v !== '' && Number.isFinite(n) && n >= min && n <= max ? n : undefined }
const str = (v: unknown, max = 500) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined)
export const cleanProfile = (b: Record<string, unknown>): Profile => ({
  heightIn: num(b.heightIn, 36, 96), weightLb: num(b.weightLb, 50, 600), age: num(b.age, 5, 120), handicap: num(b.handicap, -10, 54),
  handedness: b.handedness === 'left' || b.handedness === 'right' ? b.handedness : undefined,
  typicalMiss: str(b.typicalMiss, 40), limits: str(b.limits), goals: str(b.goals),
  clubs: Array.isArray(b.clubs) ? b.clubs.filter((x): x is string => typeof x === 'string').map((x) => x.slice(0, 20)).slice(0, 20) : undefined,
})
app.get('/profile', async (c) => {
  const row = await c.env.DB.prepare("SELECT value FROM app_settings WHERE key = 'profile'").first<{ value: string }>()
  return c.json(row ? (JSON.parse(row.value) as Profile) : {})
})
app.put('/profile', async (c) => {
  const p = cleanProfile(await c.req.json<Record<string, unknown>>())
  await c.env.DB.prepare("INSERT INTO app_settings (key, value) VALUES ('profile', ?1) ON CONFLICT(key) DO UPDATE SET value = ?1").bind(JSON.stringify(p)).run()
  return c.json(p)
})

// ---- Coach (off until the final step) ----
app.get('/ai/status', (c) => c.json(aiStatus(c.env)))
app.post('/swings/:id/analyze', (c) => {
  try { getCoach(c.env) } catch (e) { if (e instanceof CoachOffError) return c.json({ error: e.message }, 503); throw e }
  return c.json({ error: 'Not implemented' }, 501)
})

app.notFound((c) => c.json({ error: 'Not found' }, 404))

export default {
  fetch: app.fetch,
  // Daily cleanup (see wrangler.jsonc triggers): old videos and raw Garmin files go, plain data stays.
  scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) { ctx.waitUntil(purgeExpired(env)) },
}
