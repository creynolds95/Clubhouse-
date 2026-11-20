import { useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { backFrom, useHeader } from '../components/Shell'
import { Sheet } from '../components/Sheet'
import { api, shortDate } from '../lib/api'
import { useData } from '../lib/useData'
import { PHASES } from '../../shared/types'

export default function SwingDetail() {
  const { id = '' } = useParams()
  const loc = useLocation()
  const nav = useNavigate()
  const back = backFrom(loc.search, { label: 'Swings', to: '/swings' })
  const { data: s, loading, error } = useData(() => api.swing(id), [id])
  const [confirm, setConfirm] = useState(false)
  useHeader({ title: s?.club ?? 'Swing', back }, [s?.club, back.to])

  if (loading && !s) return <><div className="skeleton" style={{ height: 300 }} /><div className="skeleton" /></>
  if (error || !s) return <div className="empty"><div className="t">Swing not found.</div><div className="s">{error}</div></div>
  const m = s.metrics

  return (
    <>
      <div className="label">{shortDate(s.takenAt ?? s.createdAt)} · {s.view === 'face_on' ? 'Face on' : 'Down the line'}</div>
      <div className="hero">{m?.tempoRatio ? `${m.tempoRatio} : 1` : '—'}</div>
      <div className="cap" style={{ color: 'var(--muted)', marginBottom: 16 }}>Tempo, backswing to downswing</div>

      {s.hasVideo && <video className="player" src={`/api/swings/${s.id}/video`} controls playsInline preload="metadata" />}

      {s.frames.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>Positions</h2>
          <div className="frames">
            {PHASES.filter((p) => s.frames.includes(p)).map((p) => (
              <figure key={p}><img src={`/api/swings/${s.id}/frames/${p}`} alt={p} loading="lazy" /><figcaption>{p}</figcaption></figure>
            ))}
          </div>
        </div>
      )}

      {m && (
        <div className="card">
          <h2>Measurements</h2>
          <div className="row"><div className="grow">Spine tilt at address</div><div className="val">{fmt(m.spineTiltDeg.address)}</div></div>
          <div className="row"><div className="grow">Spine tilt at impact</div><div className="val">{fmt(m.spineTiltDeg.impact)}</div></div>
          <div className="row"><div className="grow">Shoulder turn at top</div><div className="val">{fmt(m.shoulderTurnDeg.top)}</div></div>
          <div className="row"><div className="grow">Hip turn at top</div><div className="val">{fmt(m.hipTurnDeg.top)}</div></div>
          <div className="row"><div className="grow">Lead arm at top</div><div className="val">{fmt(m.leadArmDeg)}</div></div>
          <div className="row"><div className="grow">Head movement to impact</div><div className="val">{m.headSway ? `${m.headSway.x}, ${m.headSway.y} sw` : '—'}</div></div>
          <div className="note">Angles come from your phone's view of the clip, so they are estimates. Turn angles read best face on.</div>
        </div>
      )}

      <div className="card">
        <h2>Coach</h2>
        {s.feedback ? <div className="note" style={{ color: 'var(--text)', whiteSpace: 'pre-wrap' }}>{s.feedback}</div>
          : <div className="note">Feedback turns on when the coach is connected.</div>}
      </div>

      <div className="manage">
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
const fmt = (n?: number) => (n == null ? '—' : `${n}°`)
