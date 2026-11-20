import { FilesetResolver, PoseLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision'
import type { SwingMetrics, SwingPhase } from '../../shared/types'

// Pinned to the installed package version; cached by the service worker after first use.
const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm'
const MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task'

// BlazePose landmark indices
const L = { nose: 0, lSh: 11, rSh: 12, lEl: 13, rEl: 14, lWr: 15, rWr: 16, lHip: 23, rHip: 24 }
const SAMPLE_FPS = 30

let landmarker: Promise<PoseLandmarker> | null = null
function getLandmarker() {
  landmarker ??= FilesetResolver.forVisionTasks(WASM).then((fs) =>
    PoseLandmarker.createFromOptions(fs, {
      baseOptions: { modelAssetPath: MODEL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numPoses: 1,
    }),
  )
  return landmarker
}

type Sample = { t: number; lm: NormalizedLandmark[] | null }

const seek = (v: HTMLVideoElement, t: number) =>
  new Promise<void>((res) => {
    const done = () => { v.removeEventListener('seeked', done); res() }
    v.addEventListener('seeked', done)
    v.currentTime = t
  })

export interface PoseResult {
  metrics: SwingMetrics
  frames: Partial<Record<SwingPhase, Blob>>
}

/**
 * Runs pose on-device, finds the six swing positions, measures angles and grabs a JPEG of each position.
 * Heuristics assume one golfer, roughly static camera, clip containing one full swing.
 */
export async function analyzeSwingVideo(
  file: Blob,
  handedness: 'right' | 'left',
  onProgress?: (p: number) => void,
): Promise<PoseResult> {
  const pose = await getLandmarker()
  const url = URL.createObjectURL(file)
  const v = document.createElement('video')
  v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url
  await new Promise<void>((res, rej) => { v.onloadeddata = () => res(); v.onerror = () => rej(new Error("This video can't be read on this device")) })

  const dur = v.duration
  const samples: Sample[] = []
  const n = Math.max(2, Math.floor(dur * SAMPLE_FPS))
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * Math.max(0, dur - 0.01)
    await seek(v, t)
    const r = pose.detectForVideo(v, Math.round(t * 1000) + 1)
    samples.push({ t, lm: r.landmarks[0] ?? null })
    onProgress?.((i + 1) / n)
  }

  const phases = findPhases(samples)
  const metrics = measure(samples, phases, handedness)

  const frames: Partial<Record<SwingPhase, Blob>> = {}
  for (const [phase, idx] of Object.entries(phases) as [SwingPhase, number][]) {
    await seek(v, samples[idx].t)
    frames[phase] = await grabJpeg(v)
  }
  URL.revokeObjectURL(url)
  return { metrics, frames }
}

function grabJpeg(v: HTMLVideoElement, maxEdge = 720): Promise<Blob> {
  const s = Math.min(1, maxEdge / Math.max(v.videoWidth, v.videoHeight))
  const c = document.createElement('canvas')
  c.width = Math.round(v.videoWidth * s); c.height = Math.round(v.videoHeight * s)
  c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height)
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Frame capture failed'))), 'image/jpeg', 0.85))
}

const mid = (a: NormalizedLandmark, b: NormalizedLandmark) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
const hands = (lm: NormalizedLandmark[]) => mid(lm[L.lWr], lm[L.rWr])
const deg = (r: number) => (r * 180) / Math.PI

/** Index of each phase within samples. Exported for unit tests. */
export function findPhases(samples: Sample[]): Partial<Record<SwingPhase, number>> {
  const idx = samples.map((s, i) => (s.lm ? i : -1)).filter((i) => i >= 0)
  if (idx.length < 8) throw new Error('No golfer found in this clip. Try a clip with your whole body in frame.')

  const hy = new Map(idx.map((i) => [i, hands(samples[i].lm!).y]))
  const speed = new Map<number, number>()
  for (let k = 1; k < idx.length; k++) {
    const a = hands(samples[idx[k - 1]].lm!), b = hands(samples[idx[k]].lm!)
    speed.set(idx[k], Math.hypot(b.x - a.x, b.y - a.y) / (samples[idx[k]].t - samples[idx[k - 1]].t || 1))
  }
  // Downswing has the fastest hands in the clip.
  const peak = idx.reduce((best, i) => ((speed.get(i) ?? 0) > (speed.get(best) ?? 0) ? i : best), idx[0])
  // Top: highest hands (smallest y) before peak speed.
  const before = idx.filter((i) => i < peak)
  const top = before.length ? before.reduce((b, i) => (hy.get(i)! < hy.get(b)! ? i : b), before[0]) : idx[0]
  // Address: last still moment before the hands start rising toward the top.
  const still = 0.15 * (speed.get(peak) ?? 1)
  let address = idx[0]
  for (const i of idx) { if (i >= top) break; if ((speed.get(i) ?? 0) < still) address = i }
  // Impact: hands back to (or below) address height after the top, closest to peak speed.
  const addrY = hy.get(address)!
  const after = idx.filter((i) => i > top)
  const impact = after.find((i) => hy.get(i)! >= addrY - 0.02) ?? peak
  // Finish: hands settle after impact.
  const post = idx.filter((i) => i > impact)
  const finish = post.find((i, k) => k > 3 && (speed.get(i) ?? 0) < still) ?? post[post.length - 1] ?? impact
  const nearest = (target: number) => idx.reduce((b, i) => (Math.abs(i - target) < Math.abs(b - target) ? i : b), idx[0])
  return {
    address,
    takeaway: nearest(address + (top - address) * 0.4),
    top,
    transition: nearest(top + (impact - top) * 0.5),
    impact,
    finish,
  }
}

function measure(samples: Sample[], phases: Partial<Record<SwingPhase, number>>, handedness: 'right' | 'left'): SwingMetrics {
  const at = (p: SwingPhase) => (phases[p] != null ? samples[phases[p]!].lm : null)
  const lineAngle = (a: NormalizedLandmark, b: NormalizedLandmark) => deg(Math.atan2(b.y - a.y, b.x - a.x))
  const spine = (lm: NormalizedLandmark[]) => {
    const s = mid(lm[L.lSh], lm[L.rSh]), h = mid(lm[L.lHip], lm[L.rHip])
    return Math.round(deg(Math.atan2(s.x - h.x, h.y - s.y))) // 0 = upright, + = leaning toward the right of frame
  }
  // 2D proxy for rotation: apparent shoulder/hip width shrinks as the body turns away from a face-on camera.
  const width = (lm: NormalizedLandmark[], a: number, b: number) => Math.hypot(lm[a].x - lm[b].x, lm[a].y - lm[b].y)
  const turn = (w0: number, w: number) => Math.round(deg(Math.acos(Math.min(1, Math.max(0, w / w0)))))

  const out: SwingMetrics = {
    handedness,
    phaseTimes: {}, spineTiltDeg: {}, shoulderTurnDeg: {}, hipTurnDeg: {},
    framesSampled: samples.length, framesWithPose: samples.filter((s) => s.lm).length,
  }
  const a0 = at('address')
  for (const p of Object.keys(phases) as SwingPhase[]) {
    out.phaseTimes[p] = Number(samples[phases[p]!].t.toFixed(3))
    const lm = at(p)
    if (!lm) continue
    out.spineTiltDeg[p] = spine(lm)
    if (a0) {
      out.shoulderTurnDeg[p] = turn(width(a0, L.lSh, L.rSh), width(lm, L.lSh, L.rSh))
      out.hipTurnDeg[p] = turn(width(a0, L.lHip, L.rHip), width(lm, L.lHip, L.rHip))
    }
  }
  const t = out.phaseTimes
  if (t.address != null && t.top != null && t.impact != null && t.impact > t.top)
    out.tempoRatio = Number(((t.top - t.address) / (t.impact - t.top)).toFixed(2))

  const top = at('top')
  if (top) {
    const [sh, el, wr] = handedness === 'right' ? [L.lSh, L.lEl, L.lWr] : [L.rSh, L.rEl, L.rWr]
    const a1 = lineAngle(top[el], top[sh]), a2 = lineAngle(top[el], top[wr])
    let d = Math.abs(a1 - a2); if (d > 180) d = 360 - d
    out.leadArmDeg = Math.round(d)
  }
  const imp = at('impact')
  if (a0 && imp) {
    const sw = width(a0, L.lSh, L.rSh) || 1
    out.headSway = {
      x: Number(((imp[L.nose].x - a0[L.nose].x) / sw).toFixed(2)),
      y: Number(((imp[L.nose].y - a0[L.nose].y) / sw).toFixed(2)),
    }
  }
  return out
}
