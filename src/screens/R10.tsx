import { useMemo } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useHeader } from '../components/Shell'
import { api, shortDate } from '../lib/api'
import { useData } from '../lib/useData'
import type { R10Metric } from '../../shared/types'

const COLS: [R10Metric, string, number][] = [['clubSpeed', 'Club', 0], ['ballSpeed', 'Ball', 0], ['smash', 'Smash', 2], ['carry', 'Carry', 0]]
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

export default function R10() {
  const nav = useNavigate()
  useHeader({ title: 'R10 sessions', right: <button className="iconbtn" style={{ fontWeight: 600 }} onClick={() => nav('/import?from=R10 sessions|/r10')}>Import</button> })
  const [params, setParams] = useSearchParams()
  const { data, loading } = useData(api.r10Shots)

  const sessions = useMemo(() => {
    const m = new Map<string, number>()
    data?.forEach((s) => m.set(s.sessionDate, (m.get(s.sessionDate) ?? 0) + 1))
    return [...m].sort((a, b) => (a[0] < b[0] ? 1 : -1))
  }, [data])
  const date = params.get('d') ?? sessions[0]?.[0]
  const shots = useMemo(() => (data ?? []).filter((s) => s.sessionDate === date), [data, date])
  const byClub = useMemo(() => {
    const m = new Map<string, typeof shots>()
    shots.forEach((s) => { const k = s.club ?? 'Unknown'; m.set(k, [...(m.get(k) ?? []), s]) })
    return [...m]
  }, [shots])

  if (loading && !data) return <>{[0, 1, 2].map((i) => <div key={i} className="skeleton" />)}</>
  if (!sessions.length)
    return (
      <div className="empty">
        <div className="t">No R10 sessions yet.</div>
        <div className="s">Import a session CSV from the Garmin Golf app.</div>
        <Link className="btn primary" style={{ marginTop: 20 }} to="/import?from=R10 sessions|/r10">Import a session</Link>
      </div>
    )

  return (
    <>
      <Link className="btn block" style={{ marginBottom: 16 }} to="/clubs?from=R10 sessions|/r10">Club insights: gaps, misses, trends</Link>
      <div className="chips" style={{ marginBottom: 16 }}>
        {sessions.slice(0, 8).map(([d, n]) => (
          <button key={d} className="chip" aria-pressed={d === date} onClick={() => setParams({ d }, { replace: true })}>{shortDate(d)} · {n}</button>
        ))}
      </div>
      <div className="label">{shots.length} {shots.length === 1 ? "shot" : "shots"}</div>
      <div className="card" style={{ marginTop: 8 }}>
        <div className="row" style={{ minHeight: 40 }}>
          <div className="grow cap">Club</div>
          {COLS.map(([, l]) => <div key={l} className="cap" style={{ width: 52, textAlign: 'right' }}>{l}</div>)}
        </div>
        {byClub.map(([club, ss]) => (
          <div key={club} className="row">
            <div className="grow">{club}<div className="cap">{ss.length} {ss.length === 1 ? "shot" : "shots"}</div></div>
            {COLS.map(([k, l, dp]) => {
              const a = avg(ss.map((s) => s.m[k]).filter((v): v is number => v != null))
              return <div key={l} style={{ width: 52, textAlign: 'right' }}>{a == null ? '—' : a.toFixed(dp)}</div>
            })}
          </div>
        ))}
      </div>
      <div className="note">Averages per club. Speeds in mph, carry in yards.</div>
    </>
  )
}
