import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import { useActivePlay } from '../lib/play'
import { clubNotes } from '../lib/clubNotes'
import { NoteList } from '../components/NoteList'
import { useHeader } from '../components/Shell'
import { Icon } from '../components/Icon'
import { Sheet } from '../components/Sheet'
import { Spark } from '../components/Spark'
import { api } from '../lib/api'
import { useData } from '../lib/useData'
import { updateSettings, useSettings } from '../lib/settings'
import { clubTable, practice, scoring, tempoTrend } from '../lib/dashboard'

const TILES = [
  { id: 'scoring', name: 'Scoring' },
  { id: 'roundStats', name: 'Fairways, greens, putts' },
  { id: 'clubs', name: 'Club distances' },
  { id: 'swing', name: 'Swing tempo' },
  { id: 'practice', name: 'Practice' },
  { id: 'focus', name: 'Focus this week' },
]

const f = (n: number | null, suf = '') => (n == null ? '—' : `${n}${suf}`)

export default function Home() {
  const [custom, setCustom] = useState(false)
  useHeader({ title: 'Clubhouse', right: <button className="iconbtn" aria-label="Customize" onClick={() => setCustom(true)}><Icon name="sliders" /></button> })
  const s = useSettings()
  const play = useActivePlay(), nav = useNavigate()
  // Reopening the app mid-round lands straight on the current hole (once per launch, for rounds touched in the last 12 hours).
  useEffect(() => {
    if (play && Date.now() - play.updatedAt < 12 * 3600_000 && !sessionStorage.getItem('clubhouse.resumed')) { sessionStorage.setItem('clubhouse.resumed', '1'); nav('/play?from=Home|/') }
  }, [play, nav])
  const swings = useData(api.swings), rounds = useData(api.rounds), shots = useData(api.r10Shots), ai = useData(api.aiStatus), usage = useData(api.usage)
  if ((swings.loading || rounds.loading || shots.loading) && !rounds.data && !swings.data) return <div className="skeleton" style={{ height: 280 }} />

  const R = rounds.data ?? [], S = swings.data ?? [], H = shots.data ?? []
  const sc = scoring(R), clubs = clubTable(H), tempo = tempoTrend(S), pr = practice(S, H, R)
  const order = [...TILES].sort((a, b) => {
    const ia = s.tileOrder.indexOf(a.id), ib = s.tileOrder.indexOf(b.id)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
  })

  const tiles: Record<string, React.ReactNode | null> = {
    scoring: (
      <Link key="scoring" className="tile" to="/stats?from=Home|/">
        <div className="t">Scoring avg</div>
        <div className="big">{f(sc.avg)}</div>
        <div className="sub">{sc.avg == null ? 'Log a round' : `${sc.toPar != null && sc.toPar > 0 ? '+' : ''}${f(sc.toPar)} to par${sc.delta != null ? ` · ${sc.delta <= 0 ? '▼' : '▲'}${Math.abs(sc.delta)}` : ''}`}</div>
        <Spark values={sc.trend} label="Last rounds, oldest to newest" />
      </Link>
    ),
    roundStats: (
      <Link key="roundStats" className="tile" to="/stats?from=Home|/">
        <div className="t">Last 10 rounds</div>
        <div className="mini"><span>Fairways</span><b>{f(sc.stats.fairwayPct, '%')}</b></div>
        <div className="mini"><span>Greens</span><b>{f(sc.stats.girPct, '%')}</b></div>
        <div className="mini"><span>Putts</span><b>{f(sc.stats.puttsPerRound)}</b></div>
      </Link>
    ),
    clubs: (
      <Link key="clubs" className="tile wide" to="/r10?from=Home|/">
        <div className="t">Club carry · yards</div>
        {clubs.length === 0 ? <div className="sub" style={{ padding: '10px 0' }}>Import an R10 session to see distances.</div> : (
          <table className="ctab">
            <thead><tr><th>Club</th><th>Carry</th><th>± Spread</th><th>Shots</th></tr></thead>
            <tbody>
              {clubs.slice(0, 6).map((c) => (
                <tr key={c.club}><td>{c.club}</td><td>{c.carry}</td><td className={c.spread == null ? 'dim' : ''}>{c.spread == null ? '—' : `±${c.spread}`}</td><td className="dim">{c.n}</td></tr>
              ))}
            </tbody>
          </table>
        )}
        {clubs.length > 6 && <div className="sub" style={{ marginTop: 4 }}>{clubs.length - 6} more clubs</div>}
      </Link>
    ),
    swing: (
      <Link key="swing" className="tile" to="/swings?from=Home|/">
        <div className="t">Tempo</div>
        <div className="big">{tempo.latest ? `${tempo.latest}:1` : '—'}</div>
        <div className="sub">{tempo.n ? `${tempo.n} ${tempo.n === 1 ? 'swing' : 'swings'} saved` : 'Add a swing'}</div>
        <Spark values={tempo.trend} label="Tempo, oldest to newest" />
      </Link>
    ),
    practice: (
      <Link key="practice" className="tile" to="/practice">
        <div className="t">Practice</div>
        <div className="big">{pr.streak}<span className="sub"> {pr.streak === 1 ? 'day' : 'days'} in a row</span></div>
        <div className="sub">This week: {pr.swings} {pr.swings === 1 ? 'swing' : 'swings'} · {pr.balls} balls</div>
      </Link>
    ),
    // Stays empty until the coach is on.
    focus: ai.data?.enabled ? (
      <Link key="focus" className="tile wide" to="/practice"><div className="t">Focus this week</div><div className="sub">Your weekly review sets this.</div></Link>
    ) : null,
  }

  return (
    <>
      {usage.data?.warnings[0] && <Link to="/settings" className="note" style={{ display: 'block', color: 'var(--flag)', padding: '0 0 8px' }}>{usage.data.warnings[0]}</Link>}
      {play ? (
        <Link to="/play?from=Home|/" className="card" style={{ display: 'block', padding: '14px 16px', background: 'var(--fairway)', color: 'var(--on-brand)', marginBottom: 12 }}>
          <div className="cap" style={{ color: 'var(--on-brand)' }}>ROUND IN PROGRESS</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{play.course.name} · Hole {play.idx + 1}</div>
          <div>{play.holes.filter((h) => h.strokes > 0).reduce((a, h) => a + h.strokes, 0)} so far · Tap to resume</div>
        </Link>
      ) : (
        <Link to="/play?from=Home|/" className="btn block" style={{ marginBottom: 12 }}>Play a round</Link>
      )}
      <NoteList notes={clubNotes(H).filter((n) => n.tone !== 'info' || n.id.startsWith('stale'))} limit={2} />
      <div className="dash">{order.filter((t) => !s.tilesOff.includes(t.id)).map((t) => tiles[t.id])}</div>
      {custom && (
        <Sheet title="Customize" onClose={() => setCustom(false)}>
          {order.map((t, i) => {
            const on = !s.tilesOff.includes(t.id)
            const move = (d: number) => {
              const ids = order.map((x) => x.id), j = i + d
              if (j < 0 || j >= ids.length) return
              ;[ids[i], ids[j]] = [ids[j], ids[i]]
              updateSettings({ tileOrder: ids })
            }
            return (
              <div key={t.id} className="row">
                <div className="grow">{t.name}</div>
                <button className="iconbtn" aria-label={`Move ${t.name} up`} disabled={i === 0} onClick={() => move(-1)}><Icon name="up" size={18} /></button>
                <button className="iconbtn" aria-label={`Move ${t.name} down`} disabled={i === order.length - 1} onClick={() => move(1)}><Icon name="down" size={18} /></button>
                <button className="switch" role="switch" aria-checked={on} aria-label={t.name}
                  onClick={() => updateSettings({ tilesOff: on ? [...s.tilesOff, t.id] : s.tilesOff.filter((x) => x !== t.id) })} />
              </div>
            )
          })}
        </Sheet>
      )}
    </>
  )
}
