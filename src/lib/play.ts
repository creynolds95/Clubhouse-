import { useEffect, useState } from 'react'
import type { Course, HoleScore } from '../../shared/types'

/** A round in progress. Written to the phone on every tap (localStorage for instant reads, IndexedDB as the durable copy), so a locked phone or a swiped-away app loses nothing. */
export interface PlayState {
  id: string
  course: Course
  tee: string | null
  playedOn: string
  count: 9 | 18
  idx: number
  holes: HoleScore[]
  updatedAt: number
}
const KEY = 'clubhouse.play'

// ---- IndexedDB (one key-value store) ----
const idb = (): Promise<IDBDatabase> => new Promise((res, rej) => {
  const r = indexedDB.open('clubhouse', 1)
  r.onupgradeneeded = () => r.result.createObjectStore('kv')
  r.onsuccess = () => res(r.result)
  r.onerror = () => rej(r.error)
})
async function idbGet<T>(k: string): Promise<T | null> {
  try { const db = await idb(); return await new Promise((res) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res((q.result as T) ?? null); q.onerror = () => res(null) }) } catch { return null }
}
async function idbSet(k: string, v: unknown | null) {
  try { const db = await idb(); await new Promise<void>((res) => { const tx = db.transaction('kv', 'readwrite'); v == null ? tx.objectStore('kv').delete(k) : tx.objectStore('kv').put(v, k); tx.oncomplete = () => res(); tx.onerror = () => res() }) } catch { /* storage blocked */ }
}

export const loadPlay = (): PlayState | null => { try { return JSON.parse(localStorage.getItem(KEY) ?? 'null') } catch { return null } }
export function savePlay(s: PlayState | null) {
  try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY) } catch { /* private mode */ }
  void idbSet(KEY, s)
}

/** Ask the browser not to evict our data, and pull the durable copy back if localStorage was cleared. Call once at launch. */
export async function restorePlay(): Promise<PlayState | null> {
  try { await navigator.storage?.persist?.() } catch { /* not supported */ }
  const local = loadPlay(), durable = await idbGet<PlayState>(KEY)
  const best = [local, durable].filter((x): x is PlayState => !!x).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0] ?? null
  if (best && best.updatedAt !== local?.updatedAt) { try { localStorage.setItem(KEY, JSON.stringify(best)) } catch { /* private mode */ } }
  return best
}

export function startPlay(course: Course, tee: string | null, count: 9 | 18): PlayState {
  const holes: HoleScore[] = Array.from({ length: count }, (_, i) => ({ hole: i + 1, par: course.holes[i]?.par ?? 4, strokes: 0 }))
  return { id: crypto.randomUUID(), course, tee, playedOn: new Date().toLocaleDateString('en-CA'), count, idx: 0, holes, updatedAt: Date.now() }
}

/** The round in progress. Every change is saved at once; if localStorage was wiped, the IndexedDB copy comes back on mount. */
export function usePlay() {
  const [s, setRaw] = useState<PlayState | null>(loadPlay)
  const setS = (n: PlayState | null) => { const v = n && { ...n, updatedAt: Date.now() }; savePlay(v); setRaw(v) }
  useEffect(() => { restorePlay().then((b) => { if (b && !loadPlay()) setRaw(b); else if (b && b.updatedAt > (s?.updatedAt ?? 0)) setRaw(b) }) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return [s, setS] as const
}

/** For screens that only need to know whether a round is in progress. */
export function useActivePlay() {
  const [s, setS] = useState<PlayState | null>(loadPlay)
  useEffect(() => { restorePlay().then(setS); const f = () => setS(loadPlay()); document.addEventListener('visibilitychange', f); return () => document.removeEventListener('visibilitychange', f) }, [])
  return s
}

/** Yardage of a hole from the chosen tee, if the course has it. */
export const holeYards = (s: PlayState, i: number) => s.course.tees.find((t) => t.name === s.tee)?.yards?.[i] || null
