import { useSyncExternalStore } from 'react'

/** Background-work card (UX guide §6): never blocks, survives navigation, failures persist until dismissed. */
export type FloaterState = { text: string; progress?: number; busy: boolean; error?: boolean } | null
let state: FloaterState = null
const subs = new Set<() => void>()
let fadeTimer: ReturnType<typeof setTimeout> | undefined

export const floater = {
  set(s: FloaterState) {
    clearTimeout(fadeTimer)
    state = s
    subs.forEach((f) => f())
    if (s && !s.busy && !s.error) fadeTimer = setTimeout(() => floater.set(null), 2500)
  },
  get: () => state,
  subscribe(f: () => void) { subs.add(f); return () => subs.delete(f) },
}
export const useFloater = () => useSyncExternalStore(floater.subscribe, floater.get)
