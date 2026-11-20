import { FilesetResolver, PoseLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision'
import { POSE_POINTS, type SwingMetrics, type SwingPhase } from '../../shared/types'

// Served from our own origin (scripts/copy-wasm.mjs, public/mediapipe): no CDN dependency, cached after first use.
const WASM = '/mediapipe/wasm'
const MODEL = '/mediapipe/pose_landmarker_full.task'

// BlazePose landmark indices
const L = { nose: 0, lSh: 11, rSh: 12, lEl: 13, rEl: 14, lWr: 15, rWr: 16, lHip: 23, rHip: 24 }
let sampleFps = 24 // dropped to 12 when the browser has to run the model on the CPU

const withTimeout = <T,>(p: Promise<T>, ms: number, msg: string) =>
  new Promise<T>((res, rej) => {
    const t = setTimeout(() => rej(new Error(msg)), ms)
    p.then((v) => { clearTimeout(t); res(v) }, (e) => { clearTimeout(t); rej(e) })
  })

let landmarker: Promise<PoseLandmarker> | null = null
function getLandmarker() {
  if (!landmarker) {
    const make = async () => {
      const fs = await FilesetResolver.forVisionTasks(WASM)
      const opts = (delegate: 'GPU' | 'CPU') => ({ baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'VIDEO' as const, numPoses: 1 })
      try { return await PoseLandmarker.createFromOptions(fs, opts('GPU')) }
      catch { sampleFps = 12; return await PoseLandmarker.createFromOptions(fs, opts('CPU')) } // some browsers have no WebGL for wasm
    }
    landmarker = withTimeout(make(), 60_000, "The pose model didn't load. Check your connection and retry.")
    landmarker.catch(() => { landmarker = null }) // allow a retry
  }
  return landmarker
}

type Sample = { t: number; lm: NormalizedLandmark[] | null }

const seek = (v: HTMLVideoElement, t: number) =>
  new Promise<void>((res, rej) => {
    // Seeking to the current time fires no `seeked` event; waiting for one would hang forever.
    if (Math.abs(v.currentTime - t) < 0.002 && v.readyState >= 2) return res()
    const cleanup = () => { clearTimeout(to); v.removeEventListener('seeked', done) }
    const done = () => { cleanup(); res() }
    const to = setTimeout(() => { cleanup(); rej(new Error('The video stopped responding while reading frames')) }, 5000)
    v.addEventListener('seeked', done)
    v.currentTime = t
  })

function loadVideo(file: Blob): Promise<{ v: HTMLVideoElement; url: string }> {
  const url = URL.createObjectURL(file)
  const v = document.createElement('video')
  v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url
  return withTimeout(
    new Promise((res, rej) => {
      v.onloadeddata = () => res({ v, url })
      v.onerror = () => rej(new Error("This video format can't be read here. On iPhone, set Camera to Most Compatible, or try Safari."))
      v.load()
    }),
    20_000, "The video took too long to open. Try a shorter clip.",
  )
}

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
  onStage?: (text: string, progress: number) => void,
): Promise<PoseResult> {
  onStage?.('Loading pose model…', 0)
  const pose = await getLandmarker()
  onStage?.('Opening video…', 0)
  const { v, url } = await loadVideo(file)
  try {
    const dur = v.duration
    if (!Number.isFinite(dur) || dur <= 0) throw new Error("This video has no readable length")
    const samples: Sample[] = []
    const n = Math.max(2, Math.floor(dur * sampleFps))
    for (let i = 0; i < n; i++) {
      const t = (i / (n - 1)) * Math.max(0, dur - 0.01)
      await seek(v, t)
      const r = pose.detectForVideo(v, Math.round(t * 1000) + 1)
      samples.push({ t, lm: r.landmarks[0] ?? null })
      onStage?.(`Reading frame ${i + 1} of ${n}…`, (i + 1) / n)
    }
    return await finish(v, samples, handedness)
  } finally { URL.revokeObjectURL(url) }
}

async function finish(v: HTMLVideoElement, samples: Sample[], handedness: 'right' | 'left'): Promise<PoseResult> {
  const phases = findPhases(samples)
  const metrics = measure(samples, phases, handedness)

  const frames: Partial<Record<SwingPhase, Blob>> = {}
  for (const [phase, idx] of Object.entries(phases) as [SwingPhase, number][]) {
    await seek(v, samples[idx].t)
    frames[phase] = await grabJpeg(v)
  }
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
const round = (n: number, d = 0) => Math.round(n * 10 ** d) / 10 ** d

/** Index of each phase within samples. Exported for unit tests. */
export function findPhases(samples: Sample[]): Partial<Record<SwingPhase, number>> {
  const idx = samples.map((s, i) => (s.lm ? i : -1)).filter((i) => i >= 0)
  if (idx.length < 8) throw new Error('No golfer found in this clip. Try a clip with your whole body in frame.')

  // 3-frame moving average of the hands: pose jitter otherwise creates false speed peaks.
  const raw = idx.map((i) => hands(samples[i].lm!))
  const sm = raw.map((_, k) => {
    const w = raw.slice(Math.max(0, k - 1), k + 2)
    return { x: w.reduce((s, p) => s + p.x, 0) / w.length, y: w.reduce((s, p) => s + p.y, 0) / w.length }
  })
  const hy = new Map(idx.map((i, k) => [i, sm[k].y]))
  const speed = new Map<number, number>()
  for (let k = 1; k < idx.length; k++) {
    const dt = samples[idx[k]].t - samples[idx[k - 1]].t || 1
    speed.set(idx[k], Math.hypot(sm[k].x - sm[k - 1].x, sm[k].y - sm[k - 1].y) / dt)
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
  // Impact: hands back to (or below) address height after the top.
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

/**
 * Down-the-line metrics. From behind, the image plane is the golfer's forward/up plane, so forward lean and
 * movement toward or away from the ball are directly visible. Rotation (shoulder and hip turn) is not, so it is not reported.
 * Distances are % of torso length at address, which removes camera distance.
 */
export function measure(samples: Sample[], phases: Partial<Record<SwingPhase, number>>, handedness: 'right' | 'left'): SwingMetrics {
  const at = (p: SwingPhase) => (phases[p] != null ? samples[phases[p]!].lm : null)
  const a0 = at('address')
  const out: SwingMetrics = {
    handedness, view: 'down_the_line', phaseTimes: {}, spineAngleDeg: {}, pose: {},
    framesSampled: samples.length, framesWithPose: samples.filter((s) => s.lm).length,
  }

  // Which way is "toward the ball"? At address the hands are in front of the hips, toward the ball.
  const dir = a0 ? (Math.sign(hands(a0).x - mid(a0[L.lHip], a0[L.rHip]).x) || 1) : 1
  const torso = a0 ? Math.hypot(mid(a0[L.lSh], a0[L.rSh]).x - mid(a0[L.lHip], a0[L.rHip]).x, mid(a0[L.lSh], a0[L.rSh]).y - mid(a0[L.lHip], a0[L.rHip]).y) || 0.2 : 0.2

  for (const p of Object.keys(phases) as SwingPhase[]) {
    out.phaseTimes[p] = round(samples[phases[p]!].t, 3)
    const lm = at(p)
    if (!lm) continue
    const sh = mid(lm[L.lSh], lm[L.rSh]), hp = mid(lm[L.lHip], lm[L.rHip])
    out.spineAngleDeg![p] = Math.round(deg(Math.atan2((sh.x - hp.x) * dir, hp.y - sh.y)))
    out.pose![p] = POSE_POINTS.map((i) => [round(lm[i].x, 3), round(lm[i].y, 3)])
  }
  const t = out.phaseTimes
  if (t.address != null && t.top != null && t.impact != null && t.impact > t.top)
    out.tempoRatio = round((t.top - t.address) / (t.impact - t.top), 2)

  const imp = at('impact'), top = at('top')
  const sa = out.spineAngleDeg!
  if (sa.address != null && sa.impact != null) out.spineChangeDeg = sa.impact - sa.address
  if (a0 && imp) {
    out.earlyExtensionPct = Math.round(((mid(imp[L.lHip], imp[L.rHip]).x - mid(a0[L.lHip], a0[L.rHip]).x) * dir / torso) * 100)
    out.headToImpact = head(a0, imp, dir, torso)
  }
  if (a0 && top) {
    out.headToTop = head(a0, top, dir, torso)
    const sh = mid(top[L.lSh], top[L.rSh])
    out.handsAtTopPct = Math.round(((sh.y - hands(top).y) / torso) * 100)
    const [s, e, w] = handedness === 'right' ? [L.lSh, L.lEl, L.lWr] : [L.rSh, L.rEl, L.rWr] // lead arm = left for a righty
    const v1 = { x: top[s].x - top[e].x, y: top[s].y - top[e].y }, v2 = { x: top[w].x - top[e].x, y: top[w].y - top[e].y }
    const cos = (v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y) || 1)
    out.leadArmDeg = Math.round(deg(Math.acos(Math.max(-1, Math.min(1, cos)))))
  }

  // Quality: is the whole golfer (head to ankles) visible and confidently tracked at address?
  if (a0) {
    const keys = POSE_POINTS.map((i) => a0[i])
    const vis = keys.reduce((s, k) => s + (k.visibility ?? 0), 0) / keys.length
    const ankles = [a0[27], a0[28]]
    const bodyInFrame = ankles.every((k) => (k.visibility ?? 0) > 0.5 && k.y < 0.99 && k.y > 0) && (a0[0].visibility ?? 0) > 0.5 && a0[0].y > 0.01
    out.quality = { bodyInFrame, visibility: round(vis, 2) }
  } else out.quality = { bodyInFrame: false, visibility: 0 }
  return out
}

function head(a0: NormalizedLandmark[], p: NormalizedLandmark[], dir: number, torso: number) {
  return { toward: Math.round(((p[L.nose].x - a0[L.nose].x) * dir / torso) * 100), down: Math.round(((p[L.nose].y - a0[L.nose].y) / torso) * 100) }
}
