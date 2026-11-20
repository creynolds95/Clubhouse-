import { Hono } from 'hono'
import type { R10Shot, Round, Swing, SwingPhase } from '../shared/types'
import { PHASES } from '../shared/types'
import { aiStatus, getCoach, CoachOffError, type AiEnv } from './ai'

type Env = AiEnv & { DB: D1Database; MEDIA: R2Bucket; ASSETS: Fetcher }
const app = new Hono<{ Bindings: Env }>().basePath('/api')

// Auth: Cloudflare Access sits in front of the whole hostname (single user).
// Nothing reaches this Worker without a valid Access session.

const MAX_VIDEO_BYTES = 95 * 1024 * 1024 // Workers free plan request body cap is 100 MB
const MAX_FRAME_BYTES = 2 * 1024 * 1024

type SwingRow = {
  id: string; created_at: string; taken_at: string | null; club: string | null; view: string | null
  note: string | null; video_key: string | null; frames: string; metrics: string | null; feedback: string | null
}
const toSwing = (r: SwingRow): Swing => ({
  id: r.id, createdAt: r.created_at, takenAt: r.taken_at, club: r.club, view: r.view as Swing['view'],
  note: r.note, hasVideo: !!r.video_key, frames: JSON.parse(r.frames),
  metrics: r.metrics ? JSON.parse(r.metrics) : null, feedback: r.feedback,
})
const isPhase = (p: string): p is SwingPhase => (PHASES as string[]).includes(p)

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

app.put('/swings/:id/video', async (c) => {
  const id = c.req.param('id')
  const len = Number(c.req.header('content-length') ?? 0)
  if (!len || len > MAX_VIDEO_BYTES) return c.json({ error: 'Video must be under 95 MB' }, 413)
  const key = `swings/${id}/video`
  await c.env.MEDIA.put(key, c.req.raw.body!, { httpMetadata: { contentType: c.req.header('content-type') ?? 'video/mp4' } })
  await c.env.DB.prepare('UPDATE swings SET video_key = ? WHERE id = ?').bind(key, id).run()
  return c.body(null, 204)
})

app.put('/swings/:id/frames/:phase', async (c) => {
  const { id, phase } = c.req.param()
  if (!isPhase(phase)) return c.json({ error: 'Unknown phase' }, 400)
  const buf = await c.req.arrayBuffer()
  if (buf.byteLength > MAX_FRAME_BYTES) return c.json({ error: 'Frame too large' }, 413)
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

// Media is immutable once written, so it can be cached hard on the device.
const serveMedia = async (c: { env: Env }, key: string, range?: string) => {
  const obj = await c.env.MEDIA.get(key, range ? { range: parseRange(range) } : undefined)
  if (!obj) return new Response('Not found', { status: 404 })
  const h = new Headers()
  obj.writeHttpMetadata(h)
  h.set('cache-control', 'private, max-age=31536000, immutable')
  h.set('accept-ranges', 'bytes')
  if (range && obj.range && 'offset' in obj.range) {
    const start = obj.range.offset ?? 0
    const end = start + (obj.range.length ?? obj.size) - 1
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
  return c.json({ id, total }, 201)
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
      [s.hitAt ?? s.sessionDate, s.club ?? '', s.m.ballSpeed ?? '', s.m.clubSpeed ?? '', s.m.carry ?? ''].join('|')))
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
    'SELECT id, session_date, hit_at, club, metrics FROM r10_shots ORDER BY session_date DESC, hit_at ASC LIMIT 5000',
  ).all<{ id: string; session_date: string; hit_at: string | null; club: string | null; metrics: string }>()
  const shots: R10Shot[] = results.map((r) => ({ id: r.id, sessionDate: r.session_date, hitAt: r.hit_at, club: r.club, m: JSON.parse(r.metrics) }))
  return c.json(shots)
})

app.delete('/r10/sessions/:date', async (c) => {
  await c.env.DB.prepare('DELETE FROM r10_shots WHERE session_date = ?').bind(c.req.param('date')).run()
  return c.body(null, 204)
})

// ---- Coach (off until the final step) ----
app.get('/ai/status', (c) => c.json(aiStatus(c.env)))
app.post('/swings/:id/analyze', (c) => {
  try { getCoach(c.env) } catch (e) { if (e instanceof CoachOffError) return c.json({ error: e.message }, 503); throw e }
  return c.json({ error: 'Not implemented' }, 501)
})

app.notFound((c) => c.json({ error: 'Not found' }, 404))

export default app
