import type { SwingPhase } from '../../shared/types'

/** Minimal landmark shape (matches MediaPipe's NormalizedLandmark). Kept free of imports so this file can be tested in plain Node. */
export interface LM { x: number; y: number; visibility?: number }
export type Sample = { t: number; lm: LM[] | null }

const IDX = { lSh: 11, rSh: 12, lWr: 15, rWr: 16, lHip: 23, rHip: 24 }
const mid = (a: LM, b: LM) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
const med3 = (xs: number[]) => xs.map((_, k) => { const w = xs.slice(Math.max(0, k - 1), k + 2).sort((a, b) => a - b); return w[Math.floor(w.length / 2)] })
const mean3 = (xs: number[]) => xs.map((_, k) => { const w = xs.slice(Math.max(0, k - 1), k + 2); return w.reduce((s, v) => s + v, 0) / w.length })
const smooth = (xs: number[]) => mean3(med3(xs))

/** Local maxima of xs whose prominence is at least minProm. */
function peaks(xs: number[], minProm: number): number[] {
  const out: number[] = []
  for (let k = 1; k < xs.length - 1; k++) {
    if (!(xs[k] >= xs[k - 1] && xs[k] > xs[k + 1])) continue
    let lo = xs[k], j = k
    while (j > 0 && xs[j - 1] <= xs[k]) { j--; lo = Math.min(lo, xs[j]) }
    let lo2 = xs[k]; j = k
    while (j < xs.length - 1 && xs[j + 1] <= xs[k]) { j++; lo2 = Math.min(lo2, xs[j]) }
    if (xs[k] - Math.max(lo, lo2) >= minProm) out.push(k)
  }
  return out
}

export interface PhaseResult { phases: Partial<Record<SwingPhase, number>>; low: boolean }

/**
 * Finds the six swing positions from the hands' height relative to the shoulders (in torso lengths, so it
 * ignores camera distance and body sway) and the hands' speed.
 *   top      = highest hands before the fastest downswing
 *   impact   = fastest hands (the downswing)
 *   finish   = highest hands after impact (follow-through), or the end of the clip
 *   address  = just before the hands first leave their resting height
 * `low` is true when the result looks unreliable (positions bunched together, or no clear swing).
 * Returns indices into `samples`.
 */
export function findPhases(samples: Sample[]): PhaseResult {
  const idx = samples.map((s, i) => (s.lm ? i : -1)).filter((i) => i >= 0)
  if (idx.length < 8) throw new Error('No golfer found in this clip. Try a clip with your whole body in frame.')

  const torso = idx.map((i) => { const lm = samples[i].lm!; const s = mid(lm[IDX.lSh], lm[IDX.rSh]), h = mid(lm[IDX.lHip], lm[IDX.rHip]); return Math.hypot(s.x - h.x, s.y - h.y) })
  const tMed = [...torso].sort((a, b) => a - b)[Math.floor(torso.length / 2)] || 0.2
  const hx = smooth(idx.map((i) => { const lm = samples[i].lm!; return (lm[IDX.lWr].x + lm[IDX.rWr].x) / 2 }))
  const hyRaw = idx.map((i) => { const lm = samples[i].lm!; return (lm[IDX.lWr].y + lm[IDX.rWr].y) / 2 })
  const hy = smooth(hyRaw)
  const sy = smooth(idx.map((i) => { const lm = samples[i].lm!; return (lm[IDX.lSh].y + lm[IDX.rSh].y) / 2 }))
  const h = hy.map((y, k) => (sy[k] - y) / tMed) // + = hands above shoulders
  const tt = idx.map((i) => samples[i].t)
  const sp = smooth(h.map((_, k) => {
    if (k === 0) return 0
    const dt = tt[k] - tt[k - 1] || 1
    return Math.hypot(hx[k] - hx[k - 1], hy[k] - hy[k - 1]) / tMed / dt
  }))

  const hmax = Math.max(...h), hmin = Math.min(...h), range = hmax - hmin
  const peakSp = sp.reduce((b, v, k) => (v > sp[b] ? k : b), 0)
  const prom = peaks(h, Math.max(0.3, 0.35 * range))

  // top: last prominent height peak before the fastest hands; else the highest hands before them.
  const before = prom.filter((k) => k < peakSp)
  let top = before.length ? before[before.length - 1] : -1
  if (top < 0) { top = 0; for (let k = 0; k < peakSp; k++) if (h[k] > h[top]) top = k }
  let impact = Math.max(peakSp, top + 1)
  impact = Math.min(impact, h.length - 1)
  // finish: first prominent peak after impact, else where the hands settle, else the end.
  const afterPk = prom.filter((k) => k > impact)
  let finish = afterPk.length ? afterPk[0] : -1
  if (finish < 0) {
    const calm = 0.15 * sp[peakSp]
    finish = h.length - 1
    for (let k = impact + 1; k < h.length; k++) if (tt[k] - tt[impact] > 0.3 && sp[k] < calm) { finish = k; break }
  }
  finish = Math.max(finish, impact + 1 <= h.length - 1 ? impact + 1 : impact)

  // address: last frame before the hands rise out of their resting height.
  const from = Math.max(0, tt.findIndex((t) => t >= tt[top] - 3))
  let rest = h[from]
  for (let k = from; k <= top; k++) rest = Math.min(rest, h[k])
  const rise = h[top] - rest
  let start = from
  for (let k = top; k >= from; k--) { if (h[k] <= rest + 0.12 * rise) { start = k; break } }
  let address = start
  while (address > 0 && tt[start] - tt[address] < 0.1) address--
  let takeaway = start
  for (let k = start; k <= top; k++) { if (h[k] >= rest + 0.3 * rise) { takeaway = k; break } }
  // transition: the hands have started down but are still near the top.
  const drop = h[top] - h[impact]
  let transition = top
  for (let k = top; k <= impact; k++) { if (h[k] <= h[top] - 0.2 * drop) { transition = k; break } }

  // keep the order strict where the clip is long enough to allow it
  const order = [address, takeaway, top, transition, impact, finish]
  for (let i = 1; i < order.length; i++) if (order[i] <= order[i - 1]) order[i] = Math.min(h.length - 1, order[i - 1] + 1)
  ;[address, takeaway, top, transition, impact, finish] = order

  const dur = tt[tt.length - 1] - tt[0] || 1
  const low = range < 0.5 || tt[impact] - tt[address] < 0.3 || (tt[impact] - tt[address]) / dur < 0.08 || rise < 0.3
  const at = (k: number) => idx[k]
  return { phases: { address: at(address), takeaway: at(takeaway), top: at(top), transition: at(transition), impact: at(impact), finish: at(finish) }, low }
}
