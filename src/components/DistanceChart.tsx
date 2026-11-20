import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import { clubInsights } from '../lib/clubInsights'
import { clubNotes, gapNotes, type Note } from '../lib/clubNotes'
import { NoteList } from './NoteList'

interface Row { club: string; carry: number; total: number | null }
const KEY = 'clubhouse.distances'
const NKEY = 'clubhouse.notes'
const cachedNotes = (): Note[] => { try { return JSON.parse(localStorage.getItem(NKEY) ?? '[]') } catch { return [] } }
const cached = (): Row[] => { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') } catch { return [] } }

/** Rangefinder helper: enter the yardage, get the club that fits from the player's own carry numbers, with a shorter and a longer option. Big type for sun. Cached on the phone for no-signal use. */
export function DistanceChart({ autoFocus }: { autoFocus?: boolean }) {
  const [rows, setRows] = useState<Row[]>(cached)
  const [yd, setYd] = useState('')
  const [notes, setNotes] = useState<Note[]>(cachedNotes)
  const [stale, setStale] = useState(false)
  useEffect(() => {
    api.r10Shots().then((s) => {
      const r = clubInsights(s).map((c) => ({ club: c.club, carry: c.carry, total: c.total }))
      if (r.length) {
        const n = [...clubNotes(s), ...gapNotes(clubInsights(s))]
        setRows(r); setNotes(n); setStale(false)
        try { localStorage.setItem(KEY, JSON.stringify(r)); localStorage.setItem(NKEY, JSON.stringify(n)) } catch { /* private mode */ }
      }
    }).catch(() => setStale(true))
  }, [])
  const asc = useMemo(() => [...rows].sort((a, b) => a.carry - b.carry), [rows])
  const target = Number(yd)
  const pick = useMemo(() => {
    if (!(target > 0) || !asc.length) return null
    let i = 0
    asc.forEach((r, k) => { if (Math.abs(r.carry - target) < Math.abs(asc[i].carry - target)) i = k })
    return { shorter: asc[i - 1] ?? null, normal: asc[i], longer: asc[i + 1] ?? null }
  }, [asc, target])
  if (!rows.length) return <div className="note">No range data yet. Import an R10 session and your distances show up here.</div>
  const off = (r: Row) => { const d = r.carry - target; return d === 0 ? 'dead on' : `${Math.abs(d)} ${d > 0 ? 'long' : 'short'}` }
  const step = (n: number) => setYd(String(Math.max(0, (target || 0) + n)))
  const card = (label: string, r: Row | null, main?: boolean) => (
    <div className="card" style={{ flex: main ? '1 1 100%' : 1, textAlign: 'center', padding: main ? '14px 8px' : '10px 6px', background: main ? 'var(--fairway)' : undefined, color: main ? 'var(--on-brand)' : undefined, margin: 0 }}>
      <div className="cap" style={{ color: main ? 'var(--on-brand)' : undefined }}>{label}</div>
      {r ? <><div style={{ fontSize: main ? 48 : 26, fontWeight: 800, lineHeight: 1.1 }}>{r.club}</div>
        <div style={{ fontSize: main ? 20 : 15 }}>{r.carry} carry · {off(r)}</div></> : <div style={{ fontSize: 22, padding: '8px 0' }}>—</div>}
    </div>
  )
  return (
    <>
      <div className="field"><span className="label">Yards to carry (from your rangefinder)</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" style={{ minHeight: 64, minWidth: 64, fontSize: 22 }} onClick={() => step(-5)}>−5</button>
          <input inputMode="numeric" autoFocus={autoFocus} placeholder="145" value={yd} onChange={(e) => setYd(e.target.value.replace(/\D/g, '').slice(0, 3))} style={{ fontSize: 40, fontWeight: 800, minHeight: 64, textAlign: 'center', flex: 1, minWidth: 0 }} />
          <button className="btn" style={{ minHeight: 64, minWidth: 64, fontSize: 22 }} onClick={() => step(5)}>+5</button>
        </div></div>
      {pick && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '0 16px 12px' }}>{card('Take', pick.normal, true)}{card('Shorter', pick.shorter)}{card('Longer', pick.longer)}</div>}
      {pick && <NoteList notes={notes.filter((n) => n.club && [pick.shorter?.club, pick.normal.club, pick.longer?.club].includes(n.club)).sort((a, b) => (a.tone === 'caution' ? 0 : 1) - (b.tone === 'caution' ? 0 : 1))} limit={4} />}
      <div className="card">
        <div className="row"><div className="grow cap">All clubs</div><div className="cap" style={{ width: 72, textAlign: 'right' }}>Carry</div><div className="cap" style={{ width: 72, textAlign: 'right' }}>Total</div></div>
        {[...asc].reverse().map((r) => (
          <div key={r.club} className="row" style={{ minHeight: 52, background: pick?.normal.club === r.club ? 'var(--sand)' : undefined }}>
            <div className="grow" style={{ fontSize: 20 }}>{r.club}</div>
            <div style={{ width: 72, textAlign: 'right', fontSize: 22, fontWeight: 700 }}>{r.carry}</div>
            <div style={{ width: 72, textAlign: 'right', fontSize: 18, color: 'var(--muted)' }}>{r.total ?? '—'}</div>
          </div>
        ))}
      </div>
      {stale && <div className="note">Showing the numbers saved on this phone.</div>}
    </>
  )
}
