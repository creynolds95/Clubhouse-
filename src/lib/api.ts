import type { Course, CourseCandidate, Profile, R10Shot, Round, Swing, SwingMetrics, SwingPhase } from '../../shared/types'

export interface Usage {
  retentionDays: number; lastCleanup: string | null
  requests: { used: number; limit: number }
  d1: { bytes: number; limit: number }
  r2: { bytes: number; objects: number; limit: number }
  warnings: string[]
}

/** The server answered with an error. Network failures stay TypeError (that is how fetch reports offline). */
export class ApiError extends Error { constructor(msg: string, readonly status: number) { super(msg) } }

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, init)
  if (!res.ok) {
    const msg = await res.json().then((j) => j.error).catch(() => null)
    throw new ApiError(msg || `Request failed (${res.status})`, res.status)
  }
  return res.status === 204 ? (undefined as T) : res.json()
}
const json = (method: string, body: unknown): RequestInit => ({
  method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
})

export const api = {
  profile: () => req<Profile>('/profile'),
  saveProfile: (p: Profile) => req<Profile>('/profile', json('PUT', p)),
  swings: () => req<Swing[]>('/swings'),
  linkSwing: (id: string, r10ShotId: string | null) => req<void>(`/swings/${id}/link`, json('PUT', { r10ShotId })),
  swing: (id: string) => req<Swing>(`/swings/${id}`),
  createSwing: (b: { club?: string; view?: string; takenAt?: string }) => req<{ id: string }>('/swings', json('POST', b)),
  putVideo: (id: string, file: Blob) => req<void>(`/swings/${id}/video`, { method: 'PUT', headers: { 'content-type': file.type || 'video/mp4' }, body: file }),
  putFrame: (id: string, phase: SwingPhase, jpg: Blob) => req<void>(`/swings/${id}/frames/${phase}`, { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: jpg }),
  putMetrics: (id: string, m: SwingMetrics) => req<void>(`/swings/${id}/metrics`, json('PUT', m)),
  deleteSwing: (id: string) => req<void>(`/swings/${id}`, { method: 'DELETE' }),
  rounds: () => req<Round[]>('/rounds'),
  createRound: (r: Omit<Round, 'id' | 'total'> & { externalId?: string }) => req<{ id: string; total: number }>('/rounds', json('POST', r)),
  deleteRound: (id: string) => req<void>(`/rounds/${id}`, { method: 'DELETE' }),
  uploadImport: (file: Blob, name: string, kind: string) =>
    req<{ id: string }>(`/imports?kind=${kind}&name=${encodeURIComponent(name)}`, { method: 'POST', headers: { 'content-type': (file as File).type || 'application/octet-stream' }, body: file }),
  imports: () => req<{ id: string; created_at: string; kind: string; filename: string; rows_imported: number }[]>('/imports'),
  r10Shots: () => req<R10Shot[]>('/r10/shots'),
  importR10: (importId: string, shots: R10Shot[]) => req<{ added: number; duplicates: number }>('/r10/shots', json('POST', { importId, shots })),
  deleteR10Session: (date: string) => req<void>(`/r10/sessions/${date}`, { method: 'DELETE' }),
  courses: (q = '') => req<Course[]>(`/courses?q=${encodeURIComponent(q)}`),
  courseSources: () => req<{ osm: boolean; golfcourseapi: boolean; opengolf: boolean }>('/courses/sources'),
  findCourses: (q: string, at?: { lat: number; lon: number }) =>
    req<{ candidates: CourseCandidate[]; errors: string[]; info?: string[] }>(`/courses/find?q=${encodeURIComponent(q)}${at ? `&lat=${at.lat}&lon=${at.lon}` : ''}`),
  nearCourses: (at: { lat: number; lon: number }) => req<{ candidates: CourseCandidate[]; errors: string[] }>(`/courses/near?lat=${at.lat}&lon=${at.lon}`),
  geocode: (q: string) => req<{ label: string; lat: number; lon: number }>(`/courses/geocode?q=${encodeURIComponent(q)}`),
  refreshCourse: (id: string) => req<Course>(`/courses/${id}/refresh`, json('POST', {})),
  importCourse: (c: CourseCandidate) => req<Course>('/courses/import', json('POST', c)),
  saveCourse: (c: Pick<Course, 'name' | 'city' | 'state' | 'holes' | 'tees'> & { id?: string }) =>
    c.id ? req<void>(`/courses/${c.id}`, json('PUT', c)).then(() => c.id!) : req<{ id: string }>('/courses', json('POST', c)).then((r) => r.id),
  putScorecard: (id: string, tee: string, jpg: Blob) => req<void>(`/courses/${id}/scorecard?tee=${encodeURIComponent(tee)}`, { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: jpg }),
  readScorecard: (id: string, tee: string) => req<unknown>(`/courses/${id}/scorecard/read?tee=${encodeURIComponent(tee)}`, json('POST', {})),
  deleteCourse: (id: string) => req<void>(`/courses/${id}`, { method: 'DELETE' }),
  usage: () => req<Usage>('/usage'),
  setRetention: (days: number) => req<void>('/settings/retention', json('PUT', { days })),
  purgeNow: () => req<{ videos: number; files: number; days: number }>('/maintenance/purge', { method: 'POST' }),
  aiTest: () => req<{ ok: boolean; message: string }>('/ai/test', { method: 'POST' }),
  aiStatus: () => req<{ enabled: boolean; perClipModel: string; weeklyModel: string; dailyCap?: { routine: number; deep: number } }>('/ai/status'),
  log: (limit = 150) => req<LogReport>(`/log?limit=${limit}`),
  logClient: (b: { purpose: string; outcome: 'ok' | 'error'; status?: number; ms?: number; note?: string }) => req<void>('/log/client', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }),
}

/** Frame image URL. Frames are cached as immutable, and "Read swing again" rewrites them, so the URL carries a version. */
export const frameSrc = (s: Pick<Swing, 'id' | 'metrics'>, phase: SwingPhase) => {
  const key = JSON.stringify(s.metrics?.phaseTimes ?? {})
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0
  return `/api/swings/${s.id}/frames/${phase}?v=${(h >>> 0).toString(36)}`
}

export interface LogRow { id: number; at: string; source: string; purpose: string; outcome: 'ok' | 'error' | 'cached' | 'skipped'; status: number | null; ms: number | null; quota_left: number | null; note: string | null }
export interface LogReport {
  last24h: { source: string; total: number; ok: number; errors: number; cached: number; skipped: number; avg_ms: number | null }[]
  paused: { key: string; until: string; why: string }[]
  rows: LogRow[]
  golfCourseApi: { usedToday: number; budget: number; keySet: boolean }
}

export const shortDate = (iso: string) =>
  new Date(iso.length === 10 ? iso + 'T12:00:00' : iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
