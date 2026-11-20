import { api } from './api'
import { floater } from './floater'
import type { SwingPhase } from '../../shared/types'

/** Upload → on-device pose → keyframes + metrics. Runs in the background; progress shows in the floater. */
export async function processSwing(file: File, opts: { club?: string; view?: string; handedness: 'right' | 'left' }, onDone?: (id: string) => void) {
  let id: string | undefined
  try {
    floater.set({ text: 'Uploading swing…', busy: true, progress: 0.05 })
    const takenAt = file.lastModified ? new Date(file.lastModified).toISOString() : undefined
    id = (await api.createSwing({ club: opts.club, view: opts.view, takenAt })).id
    await api.putVideo(id, file)
    floater.set({ text: 'Reading your swing…', busy: true, progress: 0.2 })
    const { analyzeSwingVideo } = await import('./pose') // ~300 KB, only loaded when needed
    const { metrics, frames } = await analyzeSwingVideo(file, opts.handedness, (p) =>
      floater.set({ text: 'Reading your swing…', busy: true, progress: 0.2 + p * 0.65 }))
    floater.set({ text: 'Saving positions…', busy: true, progress: 0.9 })
    await Promise.all(Object.entries(frames).map(([p, b]) => api.putFrame(id!, p as SwingPhase, b!)))
    await api.putMetrics(id, metrics)
    floater.set({ text: 'Swing saved', busy: false })
    onDone?.(id)
  } catch (e) {
    const msg = (e as Error).message
    floater.set({ text: id ? `Video saved. ${msg}` : `Upload failed. ${msg}`, busy: false, error: true })
    if (id) onDone?.(id)
  }
}
