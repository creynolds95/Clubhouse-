/**
 * Every call to an outside service goes through `call()`:
 *   - logged to api_log (source, purpose, outcome, status, time, quota left). No URLs, headers or keys are stored.
 *   - a source that answers 401/403/429/5xx or times out is paused for a while, so known-broken calls are not repeated.
 *   - Nominatim is held to one request a second (their usage policy).
 * Cache hits and skipped calls are logged too, so wasted or blocked calls show up in Settings > Outside services.
 */
export interface LogEnv { DB: D1Database }
export type Source = 'golfcourseapi' | 'opengolf' | 'nominatim' | 'overpass' | 'zippopotam' | 'anthropic'
export type Outcome = 'ok' | 'error' | 'cached' | 'skipped'

export const UA = 'Clubhouse/1.0 (personal golf app; low volume)'

const NAMES: Record<Source, string> = {
  golfcourseapi: 'GolfCourseAPI', opengolf: 'OpenGolfAPI', nominatim: 'OpenStreetMap search', overpass: 'OpenStreetMap',
  zippopotam: 'The ZIP lookup', anthropic: 'The coach',
}

export async function logCall(env: LogEnv, e: { source: Source; purpose: string; outcome: Outcome; status?: number | null; ms?: number; quotaLeft?: number | null; note?: string }) {
  try {
    await env.DB.prepare('INSERT INTO api_log (source, purpose, outcome, status, ms, quota_left, note) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(e.source, e.purpose.slice(0, 120), e.outcome, e.status ?? null, e.ms ?? null, e.quotaLeft ?? null, e.note?.slice(0, 200) ?? null).run()
  } catch { /* logging must never break the call */ }
}

// ---- Pause a failing source ----
const MIN = 60_000
const pauseFor = (status: number, source: Source) =>
  status === 401 || status === 403 ? 24 * 60 * MIN // blocked or bad key: no point retrying today
    : status === 429 ? 60 * MIN
      : source === 'overpass' && (status === 0 || status >= 500) ? 6 * 60 * MIN // known to time out from Cloudflare
        : status >= 500 || status === 0 ? 5 * MIN // timeout, network error or server error: likely brief
          : 0

/** Why a source is paused, or null. `key` lets each Overpass mirror pause on its own. */
export async function pausedReason(env: LogEnv, key: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT value FROM geo_cache WHERE key = ?').bind(`down:${key}`).first<{ value: string }>()
  if (!row) return null
  try {
    const v = JSON.parse(row.value) as { until: string; why: string }
    const left = Date.parse(v.until) - Date.now()
    if (left <= 0) return null
    return `${v.why}; retrying in ${left > 90 * MIN ? `${Math.round(left / (60 * MIN))} h` : `${Math.max(1, Math.round(left / MIN))} min`}`
  } catch { return null }
}
async function pause(env: LogEnv, key: string, ms: number, why: string) {
  const v = JSON.stringify({ until: new Date(Date.now() + ms).toISOString(), why })
  await env.DB.prepare("INSERT INTO geo_cache (key, value, fetched_at) VALUES (?1, ?2, strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(key) DO UPDATE SET value = ?2, fetched_at = excluded.fetched_at")
    .bind(`down:${key}`, v).run().catch(() => {})
}

// ---- Nominatim: at most one request a second from this Worker instance ----
let nomNext = 0
async function nominatimSlot() {
  const now = Date.now(), wait = nomNext - now
  nomNext = Math.max(now, nomNext) + 1100
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
}

export class PausedError extends Error { override name = 'PausedError' }

export interface CallMeta {
  source: Source
  purpose: string
  /** Pause key; defaults to the source. */
  key?: string
  /** Diagnostics ignore pauses (they exist to check whether a source is back). */
  ignorePause?: boolean
  /** Runs after the pause check and before the request. Return null to skip the call (e.g. budget used). */
  reserve?: () => Promise<{ quotaLeft?: number } | null>
  timeoutMs?: number
}

/** fetch() with logging and pausing. Throws on network errors and timeouts; returns the Response otherwise (check res.ok). */
export async function call(env: LogEnv, meta: CallMeta, url: string, init: RequestInit = {}): Promise<Response> {
  const key = meta.key ?? meta.source
  if (!meta.ignorePause) {
    const why = await pausedReason(env, key)
    if (why) {
      await logCall(env, { source: meta.source, purpose: meta.purpose, outcome: 'skipped', note: why })
      throw new PausedError(`${NAMES[meta.source]} is paused (${why}).`)
    }
  }
  let quotaLeft: number | undefined
  if (meta.reserve) {
    const r = await meta.reserve()
    if (!r) {
      await logCall(env, { source: meta.source, purpose: meta.purpose, outcome: 'skipped', quotaLeft: 0, note: 'daily budget used' })
      throw new PausedError(`${NAMES[meta.source]}: daily budget used. It resets at midnight UTC.`)
    }
    quotaLeft = r.quotaLeft
  }
  if (meta.source === 'nominatim') await nominatimSlot()
  const headers = new Headers(init.headers)
  if (!headers.has('user-agent')) headers.set('user-agent', UA)
  const t = Date.now()
  let res: Response
  try {
    res = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(meta.timeoutMs ?? 8_000) })
  } catch (e) {
    const timedOut = (e as Error).name === 'TimeoutError'
    const note = timedOut ? 'timed out' : 'network error'
    await logCall(env, { source: meta.source, purpose: meta.purpose, outcome: 'error', status: 0, ms: Date.now() - t, quotaLeft, note })
    if (!meta.ignorePause) await pause(env, key, pauseFor(0, meta.source), note)
    throw e
  }
  const ms = Date.now() - t
  await logCall(env, { source: meta.source, purpose: meta.purpose, outcome: res.ok ? 'ok' : 'error', status: res.status, ms, quotaLeft })
  const hold = res.ok ? 0 : pauseFor(res.status, meta.source)
  if (hold && !meta.ignorePause) await pause(env, key, hold, `answered ${res.status}`)
  return res
}

/** Log summary + recent rows for Settings. */
export async function logReport(env: LogEnv, limit = 150) {
  const since = new Date(Date.now() - 86_400_000).toISOString()
  const [rows, sums, paused] = await Promise.all([
    env.DB.prepare('SELECT id, at, source, purpose, outcome, status, ms, quota_left, note FROM api_log ORDER BY id DESC LIMIT ?').bind(Math.min(500, Math.max(1, limit))).all(),
    env.DB.prepare(
      `SELECT source, COUNT(*) AS total, SUM(outcome = 'ok') AS ok, SUM(outcome = 'error') AS errors, SUM(outcome = 'cached') AS cached,
              SUM(outcome = 'skipped') AS skipped, CAST(AVG(CASE WHEN ms IS NOT NULL THEN ms END) AS INTEGER) AS avg_ms
       FROM api_log WHERE at >= ? GROUP BY source ORDER BY total DESC`,
    ).bind(since).all(),
    env.DB.prepare("SELECT key, value FROM geo_cache WHERE key LIKE 'down:%'").all<{ key: string; value: string }>(),
  ])
  const pausedNow = paused.results.flatMap((r) => {
    try { const v = JSON.parse(r.value) as { until: string; why: string }; return Date.parse(v.until) > Date.now() ? [{ key: r.key.slice(5), until: v.until, why: v.why }] : [] }
    catch { return [] }
  })
  return { last24h: sums.results, paused: pausedNow, rows: rows.results }
}
