import { Link } from 'react-router-dom'
import { useHeader } from '../components/Shell'
import { api, shortDate } from '../lib/api'
import { useData } from '../lib/useData'
import { computeStats } from '../lib/stats'

export default function Home() {
  useHeader({ title: 'Clubhouse' })
  const swings = useData(api.swings)
  const rounds = useData(api.rounds)
  const loading = swings.loading && !swings.data
  const last = rounds.data?.slice(0, 5) ?? []
  const avg = computeStats(last).scoringAvg

  if (loading) return <><div className="skeleton" style={{ height: 96 }} /><div className="skeleton" /><div className="skeleton" /></>
  if (!swings.data?.length && !rounds.data?.length)
    return (
      <div className="empty">
        <img src="/icons/crest.svg" alt="" width={72} style={{ marginBottom: 16 }} />
        <div className="t">Welcome to the Clubhouse.</div>
        <div className="s">Start with a swing or your last round.</div>
        <div className="chips" style={{ justifyContent: 'center', marginTop: 20 }}>
          <Link className="btn primary" to="/swings?new=1">Add a swing</Link>
          <Link className="btn" to="/rounds/new?from=Home|/">Log a round</Link>
        </div>
      </div>
    )

  return (
    <>
      <div className="label">Scoring average · last {last.length || 0} {last.length === 1 ? 'round' : 'rounds'}</div>
      <div className="hero">{avg ?? '—'}</div>
      <div className="card" style={{ marginTop: 16 }}>
        <h2>Recent swings</h2>
        {(swings.data ?? []).slice(0, 4).map((s) => (
          <Link key={s.id} className="row chev" to={`/swings/${s.id}?from=Home|/`}>
            <div className="grow">{s.club ?? 'Swing'}<div className="cap">{shortDate(s.takenAt ?? s.createdAt)}{s.metrics?.tempoRatio ? ` · tempo ${s.metrics.tempoRatio}:1` : ''}</div></div>
          </Link>
        ))}
        <Link className="row chev" to="/swings" replace><div className="grow cap">All swings</div></Link>
      </div>
      <div className="card">
        <h2>Recent rounds</h2>
        {last.slice(0, 4).map((r) => (
          <div key={r.id} className="row"><div className="grow">{r.course}<div className="cap">{shortDate(r.playedOn)}</div></div><div className="val">{r.total}</div></div>
        ))}
        <Link className="row chev" to="/rounds" replace><div className="grow cap">All rounds</div></Link>
      </div>
    </>
  )
}
