import { useSyncExternalStore } from 'react'

export interface Settings {
  handedness: 'right' | 'left'
  defaultView: 'face_on' | 'down_the_line'
  theme: 'system' | 'light' | 'dark'
  look: 'classic' | 'sand' | 'mist' | 'stone' | 'sky' | 'ivory'
  tileOrder: string[]
  tilesOff: string[]
}
const DEFAULTS: Settings = { handedness: 'right', defaultView: 'down_the_line', theme: 'system', look: 'classic', tileOrder: [], tilesOff: [] }
const KEY = 'clubhouse.settings'
const subs = new Set<() => void>()

function read(): Settings {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') } } catch { return DEFAULTS }
}
let current = read()
const applyLook = (l: string) => { try { if (l !== 'classic') document.documentElement.setAttribute('data-look', l); else document.documentElement.removeAttribute('data-look') } catch { /* ignore */ } }
applyLook(current.look)

export function updateSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch }
  if (patch.look) applyLook(patch.look)
  try {
    localStorage.setItem(KEY, JSON.stringify(current))
    if (patch.theme) {
      if (patch.theme === 'system') { localStorage.removeItem('theme'); document.documentElement.removeAttribute('data-theme') }
      else { localStorage.setItem('theme', patch.theme); document.documentElement.setAttribute('data-theme', patch.theme) }
    }
  } catch { /* storage unavailable: settings live for this session */ }
  subs.forEach((f) => f())
}
export const useSettings = () =>
  useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f) }, () => current)
