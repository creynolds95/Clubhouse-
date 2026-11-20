import type { Course, CourseCandidate, R10Shot, Round, Swing, SwingMetrics, SwingPhase } from '../../shared/types'

export interface Usage {
  retentionDays: number; lastCleanup: string | null
  requests: { used: number; limit: number }
  d1: { bytes: number; limit: number }
  r2: { bytes: number; objects: number; limit: number }
  warnings: string[]
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, init)
  if (!res.ok) {
    const msg = await res.json().then((j) => j.error).catch(() => null)
    throw new Error(msg || `Request failed (${res.status})`)
  }
  return res.status === 204 ? (undefined as T) : res.json()
}
const json = (method: string, body: unknown): RequestInit => ({
  method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
})

export const api = {
  swings: () => req<Swing[]>('/swings'),
  swing: (id: string) => req<Swing>(`/swings/${id}`),
  createSwing: (b: { club?: string; view?: string; takenAt?: string }) => req<{ id: string }>('/swings', json('POST', b)),
  putVideo: (id: string, file: Blob) => req<void>(`/swings/${id}/video`, { method: 'PUT', headers: { 'content-type': file.type || 'video/mp4' }, body: file }),
  putFrame: (id: string, phase: SwingPhase, jpg: Blob) => req<void>(`/swings/${id}/frames/${phase}`, { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: jpg }),
  putMetrics: (id: string, m: SwingMetrics) => req<void>(`/swings/${id}/metrics`, json('PUT', m)),
  deleteSwing: (id: string) => req<void>(`/swings/${id}`, { method: 'DELETE' }),
  rounds: () => req<Round[]>('/rounds'),
  createRound: (r: Omit<Round, 'id' | 'total'>) => req<{ id: string; total: number }>('/rounds', json('POST', r)),
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
  importCourse: (c: CourseCandidate) => req<Course>('/courses/import', json('POST', c)),
  saveCourse: (c: Pick<Course, 'name' | 'city' | 'state' | 'holes' | 'tees'> & { id?: string }) =>
    c.id ? req<void>(`/courses/${c.id}`, json('PUT', c)).then(() => c.id!) : req<{ id: string }>('/courses', json('POST', c)).then((r) => r.id),
  deleteCourse: (id: string) => req<void>(`/courses/${id}`, { method: 'DELETE' }),
  usage: () => req<Usage>('/usage'),
  setRetention: (days: number) => req<void>('/settings/retention', json('PUT', { days })),
  purgeNow: () => req<{ videos: number; files: number; days: number }>('/maintenance/purge', { method: 'POST' }),
  aiStatus: () => req<{ enabled: boolean; perClipModel: string; weeklyModel: string }>('/ai/status'),
}

export const shortDate = (iso: string) =>
  new Date(iso.length === 10 ? iso + 'T12:00:00' : iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
