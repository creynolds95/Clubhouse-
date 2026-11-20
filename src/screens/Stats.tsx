import { useSearchParams } from 'react-router-dom'
import { useHeader } from '../components/Shell'
import { api } from '../lib/api'
import { useData } from '../lib/useData'
import { computeStats } from '../lib/stats'

const RANGES = [{ k: '5', label: 'Last 5' }, { k: '10', label: 'Last 10' }, { k: '20', label: 'Last 20' }, { k: 'all', label: 'All' }]

export default function Stats() {
  useHeader({ title: 'Stats' })
  const [params, setParams] = useSearchParams()
  const range = params.get('n') ?? '10'
  const { data, loading } = useData(api.rounds)
  if (loading && !data) return <div className="skeleton" style={{ height: 240 }} />
  if (!data?.length) return <div className="empty"><div className="t">No stats yet.</div><div className="s">Stats appear after your first round.</div></div>
  const rounds = range === 'all' ? data : data.slice(0, Number(range))
  const s = computeStats(rounds)
  const f = (n: number | null, suf = '') => (n == null ? '—' : `${n}${suf}`)
  const sign = (n: number | null) => (n == null ? '—' : n > 0 ? `+${n}` : `${n}`)
  return (
    <>
      <div className="chips" role="radiogroup" aria-label="Range" style={{ marginBottom: 16 }}>
        {RANGES.map((r) => <button key={r.k} role="radio" aria-checked={range === r.k} aria-pressed={range === r.k} className="chip" onClick={() => setParams(r.k === '10' ? {} : { n: r.k }, { replace: true })}>{r.label}</button>)}
      </div>
      <div className="label">Scoring average · {s.rounds} rounds</div>
      <div className="hero">{f(s.scoringAvg)}</div>
      <div className="card" style={{ marginTop: 16 }}>
        <div className="stat-grid">
          <div><div className="n">{sign(s.toPar)}</div><div className="k">To par</div></div>
          <div><div className="n">{f(s.puttsPerRound)}</div><div className="k">Putts / round</div></div>
          <div><div className="n">{f(s.fairwayPct, '%')}</div><div className="k">Fairways</div></div>
          <div><div className="n">{f(s.girPct, '%')}</div><div className="k">Greens in reg.</div></div>
          <div><div className="n">{f(s.penaltiesPerRound)}</div><div className="k">Penalties / round</div></div>
          <div><div className="n">{sign(s.byPar[3])} / {sign(s.byPar[4])} / {sign(s.byPar[5])}</div><div className="k">Par 3 / 4 / 5 vs par</div></div>
        </div>
      </div>
      <div className="note">Per-round figures are scaled to 18 holes.</div>
    </>
  )
}
