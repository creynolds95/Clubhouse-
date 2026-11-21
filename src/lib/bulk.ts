import { useSyncExternalStore } from 'react'
import { api } from './api'
import { readSwingCore } from './upload'

export interface BulkItem {
  key: string; file: File; club: string; view: string; handedness: 'right' | 'left'
  status: 'queued' | 'uploading' | 'reading' | 'done' | 'failed'
  progress: number; text: string; error?: string; swingId?: string
}
const MAX_VIDEO = 95 * 1024 * 1024
let items: BulkItem[] = []
let running = false
const subs = new Set<() => void>()
const done = new Set<() => void>()
const emit = () => { items = [...items]; subs.forEach((f) => f()) }
const patch = (key: string, p: Partial<BulkItem>) => { items = items.map((i) => (i.key === key ? { ...i, ...p } : i)); subs.forEach((f) => f()) }

/** One clip at a time, so memory and uploads stay small. A failure marks that clip and the queue carries on. */
async function run() {
  if (running) return
  running = true
  try {
    for (let next = items.find((i) => i.status === 'queued'); next; next = items.find((i) => i.status === 'queued')) {
      const it = next
      try {
        if (it.file.size > MAX_VIDEO) throw new Error('Over 95 MB. Trim the clip first')
        patch(it.key, { status: 'uploading', text: 'Uploading…', progress: 0.02 })
        const takenAt = it.file.lastModified ? new Date(it.file.lastModified).toISOString() : undefined
        const { id } = await api.createSwing({ club: it.club, view: it.view, takenAt })
        try { await api.putVideo(id, it.file) } catch (e) { await api.deleteSwing(id).catch(() => {}); throw e } // never leave a swing without its video
        patch(it.key, { status: 'reading', swingId: id, text: 'Reading swing…', progress: 0.2 })
        try { await readSwingCore(id, it.handedness, it.file, (text, p) => patch(it.key, { text, progress: 0.2 + p * 0.8 })) }
        catch (e) { patch(it.key, { status: 'done', text: `Saved, but couldn't read it: ${(e as Error).message}. Open it to retry`, progress: 1 }); done.forEach((f) => f()); continue }
        patch(it.key, { status: 'done', text: 'Done', progress: 1 })
        done.forEach((f) => f())
      } catch (e) { patch(it.key, { status: 'failed', error: (e as Error).message, text: 'Failed', progress: 0 }) }
    }
  } finally { running = false }
}

export const bulk = {
  get: () => items,
  subscribe(f: () => void) { subs.add(f); return () => subs.delete(f) },
  onItemDone(f: () => void) { done.add(f); return () => { done.delete(f) } },
  add(files: { file: File; club: string }[], view: string, handedness: 'right' | 'left') {
    const have = new Set(items.map((i) => i.key))
    const fresh = files.map(({ file, club }) => ({ key: `${file.name}|${file.size}|${file.lastModified}`, file, club, view, handedness, status: 'queued' as const, progress: 0, text: 'Waiting' }))
      .filter((i) => !have.has(i.key))
    items = [...items, ...fresh]; emit(); void run()
    return fresh.length
  },
  retry(key: string) { patch(key, { status: 'queued', error: undefined, text: 'Waiting', progress: 0 }); void run() },
  clearFinished() { items = items.filter((i) => i.status !== 'done'); emit() },
  dismiss(key: string) { items = items.filter((i) => i.key !== key); emit() },
}
export const useBulk = () => useSyncExternalStore(bulk.subscribe, bulk.get)
