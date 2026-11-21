export interface MaintEnv { DB: D1Database; MEDIA: R2Bucket }

export const FREE = {
  requestsPerDay: 100_000,
  d1Bytes: 5 * 1024 ** 3,
  r2Bytes: 10 * 1024 ** 3,
}
export const DEFAULT_RETENTION_DAYS = 7

const day = () => new Date().toISOString().slice(0, 10)

export async function getRetentionDays(env: MaintEnv): Promise<number> {
  const r = await env.DB.prepare("SELECT value FROM app_settings WHERE key = 'retention_days'").first<{ value: string }>()
  const n = r ? Number(r.value) : DEFAULT_RETENTION_DAYS
  return Number.isFinite(n) && n >= 1 ? n : DEFAULT_RETENTION_DAYS
}

export async function setRetentionDays(env: MaintEnv, days: number) {
  await env.DB.prepare("INSERT INTO app_settings (key, value) VALUES ('retention_days', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(String(days)).run()
}

export function bumpRequests(env: MaintEnv) {
  return env.DB.prepare('INSERT INTO usage_daily (day, requests) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET requests = requests + 1').bind(day()).run()
}

/** Delete swing videos and raw Garmin files older than the retention window. Frames, measurements and parsed shots stay. */
export async function purgeExpired(env: MaintEnv) {
  const days = await getRetentionDays(env)
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString()

  // R2 deletes up to 1000 keys per call; anything beyond that goes on the next daily run.
  const videos = await env.DB.prepare("SELECT id, video_key FROM swings WHERE video_key IS NOT NULL AND created_at < ? LIMIT 1000").bind(cutoff).all<{ id: string; video_key: string }>()
  if (videos.results.length) {
    await env.MEDIA.delete(videos.results.map((v) => v.video_key))
    await env.DB.batch(videos.results.map((v) => env.DB.prepare('UPDATE swings SET video_key = NULL WHERE id = ?').bind(v.id)))
  }
  // a swing is a video: drop stray records that never got one (failed uploads), but keep ones whose video aged out
  const orphanCut = new Date(Date.now() - 3_600_000).toISOString()
  await env.DB.prepare("DELETE FROM swings WHERE video_key IS NULL AND (frames IS NULL OR frames = '[]') AND metrics IS NULL AND created_at < ?").bind(orphanCut).run()
  const files = await env.DB.prepare("SELECT id, r2_key FROM imports WHERE r2_key != '' AND created_at < ? LIMIT 1000").bind(cutoff).all<{ id: string; r2_key: string }>()
  if (files.results.length) {
    await env.MEDIA.delete(files.results.map((f) => f.r2_key))
    await env.DB.batch(files.results.map((f) => env.DB.prepare("UPDATE imports SET r2_key = '' WHERE id = ?").bind(f.id)))
  }
  // Housekeeping so D1 doesn't grow forever: the call log keeps 30 days, old budget counters and pauses go,
  // lookup caches older than 120 days go. Saved course cards (gcad:, ogd:) are kept.
  const ago = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString()
  await env.DB.batch([
    env.DB.prepare('DELETE FROM api_log WHERE at < ?').bind(ago(30)),
    env.DB.prepare("DELETE FROM geo_cache WHERE (key LIKE 'gca-used:%' OR key LIKE 'down:%') AND fetched_at < ?").bind(ago(3)),
    env.DB.prepare("DELETE FROM geo_cache WHERE key NOT LIKE 'gcad:%' AND key NOT LIKE 'ogd:%' AND fetched_at < ?").bind(ago(120)),
    env.DB.prepare('DELETE FROM usage_daily WHERE day < ?').bind(ago(90).slice(0, 10)),
  ])
  await env.DB.prepare("INSERT INTO app_settings (key, value) VALUES ('last_purge', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(new Date().toISOString()).run()
  await env.DB.prepare("DELETE FROM app_settings WHERE key = 'r2_usage'").run() // force a fresh size next time
  return { videos: videos.results.length, files: files.results.length, days }
}

/**
 * Upload guard: refuse a new file if it would push R2 past 90% of the free 10 GB. Uses the last measured size
 * (no extra list calls on upload); the size is re-measured at most every 6 hours and after each cleanup.
 */
export async function r2HasRoom(env: MaintEnv, incomingBytes: number) {
  const row = await env.DB.prepare("SELECT value FROM app_settings WHERE key = 'r2_usage'").first<{ value: string }>()
  if (!row) return true
  const { bytes } = JSON.parse(row.value) as { bytes: number }
  return bytes + incomingBytes < FREE.r2Bytes * 0.9
}

/** R2 size by listing objects. List calls are billed operations, so the result is cached for 6 hours. */
async function r2Usage(env: MaintEnv) {
  const cached = await env.DB.prepare("SELECT value FROM app_settings WHERE key = 'r2_usage'").first<{ value: string }>()
  if (cached) {
    const c = JSON.parse(cached.value) as { at: string; bytes: number; objects: number }
    if (Date.now() - Date.parse(c.at) < 6 * 3_600_000) return c
  }
  let bytes = 0, objects = 0, cursor: string | undefined
  do {
    const page = await env.MEDIA.list({ cursor, limit: 1000 })
    for (const o of page.objects) { bytes += o.size; objects++ }
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  const fresh = { at: new Date().toISOString(), bytes, objects }
  await env.DB.prepare("INSERT INTO app_settings (key, value) VALUES ('r2_usage', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(JSON.stringify(fresh)).run()
  return fresh
}

export async function usageReport(env: MaintEnv) {
  const [days, r2, size, today, last] = await Promise.all([
    getRetentionDays(env),
    r2Usage(env),
    env.DB.prepare('SELECT 1').run(),
    env.DB.prepare('SELECT requests FROM usage_daily WHERE day = ?').bind(day()).first<{ requests: number }>(),
    env.DB.prepare("SELECT value FROM app_settings WHERE key = 'last_purge'").first<{ value: string }>(),
  ])
  const d1Bytes = Number((size.meta as { size_after?: number }).size_after ?? 0)
  const requests = today?.requests ?? 0
  const ratio = { requests: requests / FREE.requestsPerDay, d1: d1Bytes / FREE.d1Bytes, r2: r2.bytes / FREE.r2Bytes }
  const warnings: string[] = []
  if (ratio.requests >= 0.8) warnings.push('Requests today are near the free limit.')
  if (ratio.d1 >= 0.8) warnings.push('The database is near the free size limit.')
  if (ratio.r2 >= 0.8) warnings.push('File storage is near the free limit.')
  return {
    retentionDays: days, lastCleanup: last?.value ?? null,
    requests: { used: requests, limit: FREE.requestsPerDay },
    d1: { bytes: d1Bytes, limit: FREE.d1Bytes },
    r2: { bytes: r2.bytes, objects: r2.objects, limit: FREE.r2Bytes },
    warnings,
  }
}
