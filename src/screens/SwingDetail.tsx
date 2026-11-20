import { useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { backFrom, useHeader } from '../components/Shell'
import { Sheet } from '../components/Sheet'
import { api, shortDate } from '../lib/api'
import { useData } from '../lib/useData'
import { useSettings } from '../lib/settings'
import { analyzeStored } from '../lib/upload'
import { PHASES, POSE_BONES, type SwingMetrics, type SwingPhase } from '../../shared/types'

export default function SwingDetail() {
  const { id = '' } = useParams()
  const loc = useLocation()
  const nav = useNavigate()
  const back = backFrom(loc.search, { label: 'Swings', to: '/swings' })
  const { data: s, loading, error, reload } = useData(() => api.swing(id), [id])
  const settings = useSettings()
  const [confirm, setConfirm] = useState(false)
  const [tracking, setTracking] = useState(false)
  useHeader({ title: s?.club ?? 'Swing', back }, [s?.club, back.to])

  if (loading && !s) return <><div className="skeleton" style={{ height: 300 }} /><div className="skeleton" /></>
  if (error || !s) return <div className="empty"><div className="t">Swing not found.</div><div className="s">{error}</div></div>
  const m = s.metrics

  return (
    <>
      <div className="label">{shortDate(s.takenAt ?? s.createdAt)} · {s.view === 'face_on' ? 'Face on' : 'From behind'}</div>
      <div className="hero">{m?.tempoRatio ? `${m.tempoRatio} : 1` : '—'}</div>
      <div className="cap" style={{ color: 'var(--muted)', marginBottom: 16 }}>Tempo, backswing to downswing</div>

      {!s.hasVideo && s.frames.length > 0 && <div className="note" style={{ padding: 0 }}>The video was removed to save space. Key frames and measurements are kept.</div>}
      {s.hasVideo && <video className="player" src={`/api/swings/${s.id}/video`} controls playsInline preload="metadata" />}

      {s.hasVideo && !m && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="note">This swing hasn't been read yet.</div>
          <div style={{ padding: '0 16px 16px' }}>
            <button className="btn primary block" onClick={() => analyzeStored(s.id, settings.handedness, reload)}>Read swing</button>
          </div>
        </div>
      )}

      {s.frames.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>Positions</h2>
          {m?.pose && (
            <div style={{ padding: '0 16px 8px' }}>
              <button className="chip" aria-pressed={tracking} onClick={() => setTracking((t) => !t)}>Show tracking</button>
            </div>
          )}
          <div className="frames">
            {PHASES.filter((p) => s.frames.includes(p)).map((p) => (
              <figure key={p}>
                <div style={{ position: 'relative' }}>
                  <img src={`/api/swings/${s.id}/frames/${p}`} alt={p} loading="lazy" />
                  {tracking && m?.pose?.[p] && <Skeleton pts={m.pose[p]!} />}
                </div>
                <figcaption>{p}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      )}

      {m && <Measurements m={m} />}

      <div className="card">
        <h2>Coach</h2>
        {s.feedback ? <div className="note" style={{ color: 'var(--text)', whiteSpace: 'pre-wrap' }}>{s.feedback}</div>
          : <div className="note">Feedback turns on when the coach is connected.</div>}
      </div>

      {s.hasVideo && m && (
        <div className="manage" style={{ marginTop: 16 }}>
          <button className="btn block" onClick={() => analyzeStored(s.id, settings.handedness, reload)}>Read swing again</button>
        </div>
      )}
      <div className="manage" style={{ marginTop: 16 }}>
        <button className="btn block danger" onClick={() => setConfirm(true)}>Delete swing</button>
      </div>
      {confirm && (
        <Sheet title="Delete swing" onClose={() => setConfirm(false)}>
          <div className="note">This erases the video, positions and measurements.</div>
          <div style={{ padding: '0 16px' }}>
            <button className="btn block danger" onClick={async () => { await api.deleteSwing(s.id); nav(back.to, { replace: true }) }}>Delete swing</button>
          </div>
        </Sheet>
      )}
    </>
  )
}


const deg = (n?: number) => (n == null ? '—' : `${n}°`)
const pct = (n: number) => `${Math.abs(n)}%`
const headWords = (h?: { toward: number; down: number }) => {
  if (!h) return '—'
  if (Math.abs(h.toward) < 3 && Math.abs(h.down) < 3) return 'Steady'
  const parts: string[] = []
  if (Math.abs(h.toward) >= 3) parts.push(`${pct(h.toward)} ${h.toward > 0 ? 'toward ball' : 'away'}`)
  if (Math.abs(h.down) >= 3) parts.push(`${pct(h.down)} ${h.down > 0 ? 'down' : 'up'}`)
  return parts.join(', ')
}

function Skeleton({ pts }: { pts: number[][] }) {
  return (
    <svg viewBox="0 0 1 1" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} aria-hidden="true">
      {POSE_BONES.map(([a, b], i) => (
        <line key={i} x1={pts[a][0]} y1={pts[a][1]} x2={pts[b][0]} y2={pts[b][1]} stroke="#e9c46a" strokeWidth="0.012" strokeLinecap="round" />
      ))}
      {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="0.014" fill="#9a4a3a" />)}
    </svg>
  )
}

function Measurements({ m }: { m: SwingMetrics }) {
  if (!m.spineAngleDeg) {
    return (
      <div className="card">
        <h2>Measurements</h2>
        <div className="note">Measured with the first method, which doesn't suit clips from behind. Use Read swing again below.</div>
      </div>
    )
  }
  const sa = m.spineAngleDeg
  const ee = m.earlyExtensionPct
  const ch = m.spineChangeDeg
  const row = (label: string, value: string) => <div className="row"><div className="grow">{label}</div><div className="val">{value}</div></div>
  return (
    <>
      {m.quality && !m.quality.bodyInFrame && (
        <div className="card"><div className="note" style={{ color: 'var(--flag)' }}>Your whole body wasn't in frame, so these numbers are rough. Film from behind with head to feet visible.</div></div>
      )}
      <div className="card">
        <h2>From behind</h2>
        {row('Spine angle at address', deg(sa.address))}
        {row('Spine angle at impact', deg(sa.impact))}
        {row('Spine angle change', ch == null ? '—' : Math.abs(ch) < 3 ? 'Held' : ch < 0 ? `Stood up ${-ch}°` : `Bent more ${ch}°`)}
        {row('Hips, address to impact', ee == null ? '—' : Math.abs(ee) < 5 ? 'Held' : ee > 0 ? `${ee}% toward ball` : `${-ee}% away`)}
        {row('Head, address to top', headWords(m.headToTop))}
        {row('Head, address to impact', headWords(m.headToImpact))}
        {row('Lead arm at top', deg(m.leadArmDeg))}
        {row('Hands at top', m.handsAtTopPct == null ? '—' : m.handsAtTopPct >= 0 ? `${m.handsAtTopPct}% above shoulders` : `${-m.handsAtTopPct}% below shoulders`)}
        <div className="note">Read on your phone by a pose-tracking model (Google MediaPipe), not an AI service. Distances are a percentage of your torso length. Turn and club plane can't be measured from behind.</div>
      </div>
    </>
  )
}
