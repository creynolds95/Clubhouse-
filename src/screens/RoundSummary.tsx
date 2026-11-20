import { useEffect, useState } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import { backFrom, useHeader } from '../components/Shell'
import { HBars, HoleBars, Split } from '../components/Charts'
import { api, shortDate } from '../lib/api'
import { summarize } from '../lib/roundSummary'
import type { Round } from '../../shared/types'

const CACHE = 'clubhouse.roundsCache'
const rd = <T,>(k: string): T | null => { try { return JSON.parse(localStorage.getItem(k) ?? 'null') } catch { return null } }
/** Keep the finished round and the recent rounds on the phone so the summary opens with no signal. */
export const stashRound = (key: string, r: Round) => { try { localStorage.setItem(`clubhouse.round.${key}`, JSON.stringify(r)) } catch { /* private mode */ } }

export default function RoundSummary() {
  const { id = '' } = useParams()
  const loc = useLocation()
  useHeader({ title: 'Round summary', back: backFrom(loc.search, { label: 'Rounds', to: '/rounds' }) })
  const [round, setRound] = useState<Round | null>(id.startsWith('local-') ? rd<Round>(`clubhouse.round.${id}`) : null)
  const [all, setAll] = useState<Round[]>(rd<Round[]>(CACHE) ?? [])
  const [missing, setMissing] = useState(false)
  useEffect(() => {
    api.rounds().then((rs) => {
      setAll(rs); try { localStorage.setItem(CACHE, JSON.stringify(rs.slice(0, 20))) } catch { /* private mode */ }
      const hit = rs.find((r) => r.id === id)
      if (hit) { setRound(hit); stashRound(id, hit) }
      else if (!round) setMissing(true)
    }).catch(() => { if (!round) { const c = rd<Round>(`clubhouse.round.${id}`); c ? setRound(c) : setMissing(true) } })
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!round) return missing ? <div className="empty"><div className="t">Round not found.</div><div className="s">Open it again once you're online.</div></div> : <div className="skeleton" style={{ height: 300 }} />

  const prev = all.filter((r) => r.id !== round.id && r.playedOn <= round.playedOn)
  const s = summarize(round, prev)
  const par = round.holes.reduce((a, h) => a + h.par, 0), diff = round.total - par
  const labels = round.holes.map((h) => String(h.hole))
  return (
    <>
      <div className="label">{round.course} · {shortDate(round.playedOn)}{round.tees ? ` · ${round.tees}` : ''}</div>
      <div className="hero">{round.total} <span style={{ fontSize: 22 }}>{diff === 0 ? 'E' : diff > 0 ? `+${diff}` : diff}</span></div>
      <div className="card" style={{ marginTop: 12, paddingTop: 12 }}>
        {s.headlines.map((h, i) => <div key={i} style={{ padding: '0 16px 10px', display: 'flex', gap: 10 }}><b style={{ color: 'var(--brass)' }}>{i + 1}</b><span>{h}</span></div>)}
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <h2>Score by hole vs par</h2>
        <HoleBars title="Score by hole against par" values={s.vsPar} labels={labels} readout={(i) => `Hole ${i + 1}: par ${round.holes[i].par}, scored ${round.holes[i].strokes} (${s.vsPar[i] > 0 ? '+' : ''}${s.vsPar[i]})`} />
        {s.nines && <div className="cap" style={{ padding: '0 16px 12px' }}>Front nine {s.nines.front} ({s.nines.front - s.nines.frontPar >= 0 ? '+' : ''}{s.nines.front - s.nines.frontPar}) · Back nine {s.nines.back} ({s.nines.back - s.nines.backPar >= 0 ? '+' : ''}{s.nines.back - s.nines.backPar})</div>}
      </div>

      {s.lost && (
        <div className="card" style={{ marginTop: 12 }}>
          <h2>Where strokes went</h2>
          <HBars rows={s.lost.map((l) => ({ label: l.label, value: l.shots, note: l.note }))} />
          <div className="cap" style={{ padding: '0 16px 12px' }}>An estimate from what you entered, not exact strokes gained.</div>
        </div>
      )}

      {s.putts.some((p) => p != null) && (
        <div className="card" style={{ marginTop: 12 }}>
          <h2>Putts by hole</h2>
          <HoleBars title="Putts by hole against two" baseline={2} values={s.putts} labels={labels} readout={(i) => `Hole ${i + 1}: ${s.putts[i] ?? '—'} putts`} />
          <div className="cap" style={{ padding: '0 16px 12px' }}>{s.putts.reduce<number>((a, p) => a + (p ?? 0), 0)} putts. Bars above the line are 3-putts or worse.</div>
        </div>
      )}

      {(s.fairway || s.gir) && (
        <div className="card" style={{ marginTop: 12 }}>
          <h2>Fairways and greens</h2>
          {s.fairway && <><div className="cap" style={{ padding: '0 16px' }}>Fairways · {s.fairway.hit} of {s.fairway.n}</div>
            <Split parts={[{ label: 'Left', value: s.fairway.left, color: 'var(--flag)' }, { label: 'Hit', value: s.fairway.hit, color: 'var(--fairway)' }, { label: 'Right', value: s.fairway.right, color: 'var(--brass)' }]} /></>}
          {s.gir && <><div className="cap" style={{ padding: '0 16px' }}>Greens in regulation · {s.gir.yes} of {s.gir.n}</div>
            <Split parts={[{ label: 'Hit', value: s.gir.yes, color: 'var(--fairway)' }, { label: 'Missed', value: s.gir.no, color: 'var(--flag)' }]} /></>}
        </div>
      )}

      {s.vsAvg.length > 0 && (
        <div className="card" style={{ marginTop: 12 }}>
          <h2>Against your recent average</h2>
          {s.vsAvg.map((v) => {
            const better = v.now == null || v.avg == null ? null : v.lowerIsBetter ? v.now < v.avg : v.now > v.avg
            return <div key={v.label} className="row"><div className="grow">{v.label}</div><div className="val" style={{ color: better == null ? undefined : better ? 'var(--fairway)' : 'var(--flag)' }}>{v.now ?? '—'}{v.now != null ? v.suffix : ''} <span className="cap">vs {v.avg ?? '—'}{v.avg != null ? v.suffix : ''}</span></div></div>
          })}
        </div>
      )}
      <div className="note">Built from your scorecard. A plain-language write-up can be added when the coach is switched on.</div>
    </>
  )
}
