import { Link, useNavigate } from 'react-router-dom'
import { loadPlay } from '../lib/play'
import { useHeader } from '../components/Shell'
import { Icon } from '../components/Icon'
import { api, shortDate } from '../lib/api'
import { useData } from '../lib/useData'

export default function Rounds() {
  const nav = useNavigate()
  useHeader({ title: 'Rounds', right: <><button className="iconbtn" style={{ fontWeight: 600 }} onClick={() => nav('/play?from=Rounds|/rounds')}>{loadPlay() ? 'Resume' : 'Play'}</button><button className="iconbtn" aria-label="Log round" onClick={() => nav('/rounds/new?from=Rounds|/rounds')}><Icon name="plus" /></button></> })
  const { data, loading, error } = useData(api.rounds)
  if (loading && !data) return <>{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" />)}</>
  return (
    <>
      {error && <div className="note">Couldn't load rounds. {error}</div>}
      {!data?.length ? (
        <div className="empty"><div className="t">No rounds yet.</div><div className="s">Log a round by hole, or import your Garmin history.</div>
          <Link className="btn primary" style={{ marginTop: 20 }} to="/rounds/new?from=Rounds|/rounds">Log a round</Link></div>
      ) : (
        <div className="card">
          {data.map((r) => {
            const par = r.holes.reduce((s, h) => s + h.par, 0)
            const diff = r.total - par
            return (
              <div key={r.id} className="row">
                <div className="grow">{r.course}<div className="cap">{shortDate(r.playedOn)} · {r.holes.length} holes{r.tees ? ` · ${r.tees}` : ''}</div></div>
                <div style={{ textAlign: 'right' }}><div style={{ fontWeight: 600 }}>{r.total}</div><div className="cap" style={{ color: 'var(--muted)', fontSize: 13 }}>{diff === 0 ? 'E' : diff > 0 ? `+${diff}` : diff}</div></div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
