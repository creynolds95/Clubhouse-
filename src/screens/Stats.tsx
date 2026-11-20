import { useSearchParams } from 'react-router-dom'
import { useHeader } from '../components/Shell'
import { api } from '../lib/api'
import { useData } from '../lib/useData'
import { byCourse, computeStats, missPatterns, strokesLost } from '../lib/stats'

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
      <div className="card" style={{ marginTop: 12 }}>
        <div className="stat-grid">
          <div><div className="n">{f(s.upDownPct, '%')}</div><div className="k">Up and down</div></div>
          <div><div className="n">{f(s.threePuttsPerRound)}</div><div className="k">3-putts / round</div></div>
        </div>
      </div>
      <div className="note">Per-round figures are scaled to 18 holes.</div>
      {(() => { const m = missPatterns(rounds); return m && (
        <><div className="label" style={{ marginTop: 16 }}>Fairway misses · {m.n} holes</div>
          <div className="card" style={{ marginTop: 8 }}><div className="stat-grid">
            <div><div className="n">{m.left}%</div><div className="k">Missed left</div></div>
            <div><div className="n">{m.hit}%</div><div className="k">Hit</div></div>
            <div><div className="n">{m.right}%</div><div className="k">Missed right</div></div>
          </div></div>
          {Math.abs(m.left - m.right) >= 12 && <div className="note">Your tee shots miss {m.left > m.right ? 'left' : 'right'} more often ({Math.max(m.left, m.right)}% vs {Math.min(m.left, m.right)}%).</div>}</>
      ) })()}
      {(() => { const l = strokesLost(rounds); return (
        <><div className="label" style={{ marginTop: 16 }}>Where you lose shots</div>
          {l ? <div className="card" style={{ marginTop: 8 }}>{l.map((x) => (
            <div key={x.label} className="row"><div className="grow">{x.label}<div className="cap">{x.note}</div></div><div className="val"><b>{x.shots}</b> / round</div></div>
          ))}</div> : <div className="note">Needs 2 rounds with putts entered on every hole.</div>}
          {l && <div className="note">An estimate from your scorecards, per 18 holes. It shows where the extra strokes go, not exact strokes gained.</div>}</>
      ) })()}
      {(() => { const c = byCourse(rounds); return c.length > 0 && (
        <><div className="label" style={{ marginTop: 16 }}>By course</div>
          <div className="card" style={{ marginTop: 8 }}>{c.map((x) => (
            <div key={x.course} className="row" style={{ display: 'block', padding: '12px 16px' }}>
              <b>{x.course}</b>
              <div className="cap">{x.rounds} {x.rounds === 1 ? 'round' : 'rounds'} · avg {Math.round(x.avg)} · best {x.best}{x.putts != null ? ` · ${x.putts} putts` : ''}{x.fairwayPct != null ? ` · ${x.fairwayPct}% fairways` : ''}{x.girPct != null ? ` · ${x.girPct}% greens` : ''}</div>
            </div>
          ))}</div></>
      ) })()}
    </>
  )
}
