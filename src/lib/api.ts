import type { Round, Swing, SwingMetrics, SwingPhase } from '../../shared/types'

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
  aiStatus: () => req<{ enabled: boolean; perClipModel: string; weeklyModel: string }>('/ai/status'),
}

export const shortDate = (iso: string) =>
  new Date(iso.length === 10 ? iso + 'T12:00:00' : iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
