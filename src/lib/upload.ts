import { api } from './api'
import { floater } from './floater'
import type { SwingPhase } from '../../shared/types'

type Handed = 'right' | 'left'

/** Read a swing video and store its key frames and metrics. Reports progress as text and 0..1. */
export async function readSwingCore(id: string, handedness: Handed, blob: Blob, onProgress: (text: string, p: number) => void) {
  const { analyzeSwingVideo } = await import('./pose') // ~300 KB, only loaded when needed
  const { metrics, frames } = await analyzeSwingVideo(blob, handedness, (text, p) => onProgress(text, 0.05 + p * 0.85))
  onProgress('Saving positions…', 0.92)
  await Promise.all(Object.entries(frames).map(([p, b]) => api.putFrame(id, p as SwingPhase, b!)))
  await api.putMetrics(id, metrics)
}

/** Pose → keyframes + metrics for a swing whose video is already stored. Safe to rerun. */
export async function analyzeStored(id: string, handedness: Handed, onDone?: (id: string) => void, file?: Blob) {
  const retry = () => analyzeStored(id, handedness, onDone)
  try {
    floater.set({ text: 'Preparing…', busy: true, progress: 0.05 })
    const blob: Blob = file ?? (await fetch(`/api/swings/${id}/video`).then((r) => { if (!r.ok) throw new Error('Could not load the saved video'); return r.blob() }))
    const { analyzeSwingVideo } = await import('./pose') // ~300 KB, only loaded when needed
    const { metrics, frames } = await analyzeSwingVideo(blob, handedness, (text, p) =>
      floater.set({ text, busy: true, progress: 0.1 + p * 0.75 }))
    floater.set({ text: 'Saving positions…', busy: true, progress: 0.9 })
    await Promise.all(Object.entries(frames).map(([p, b]) => api.putFrame(id, p as SwingPhase, b!)))
    await api.putMetrics(id, metrics)
    floater.set({ text: 'Swing read', busy: false })
    onDone?.(id)
  } catch (e) {
    floater.set({ text: `Couldn't read this swing. ${(e as Error).message}`, busy: false, error: true, action: { label: 'Retry', run: retry } })
    onDone?.(id)
  }
}

/** Upload, then read the swing in the background. Progress shows in the floater. */
export async function processSwing(file: File, opts: { club?: string; view?: string; handedness: Handed }, onDone?: (id: string) => void) {
  let id: string
  try {
    floater.set({ text: 'Uploading swing…', busy: true, progress: 0.02 })
    const takenAt = file.lastModified ? new Date(file.lastModified).toISOString() : undefined
    id = (await api.createSwing({ club: opts.club, view: opts.view, takenAt })).id
    try { await api.putVideo(id, file) } catch (e) { await api.deleteSwing(id).catch(() => {}); throw e } // a swing never exists without its video
  } catch (e) {
    floater.set({ text: `Upload failed. ${(e as Error).message}`, busy: false, error: true })
    return
  }
  await analyzeStored(id, opts.handedness, onDone, file)
}
