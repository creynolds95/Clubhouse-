import { useEffect, useState } from 'react'
import { Sheet } from './Sheet'
import { CourseEditor } from './CourseEditor'
import { api } from '../lib/api'
import { floater } from '../lib/floater'
import { useData } from '../lib/useData'
import type { Course, CourseCandidate } from '../../shared/types'

export const parOf = (c: Course) => c.holes.reduce((s, h) => s + h.par, 0)

type Area = { label: string; lat: number; lon: number }
const DFW: Area = { label: 'DFW', lat: 32.78, lon: -96.8 }
const loadArea = (): Area => { try { return JSON.parse(localStorage.getItem('clubhouse.area') ?? '') as Area } catch { return DFW } }
const saveArea = (a: Area) => { try { localStorage.setItem('clubhouse.area', JSON.stringify(a)) } catch { /* private mode */ } }
const mi = (km?: number) => (km == null ? null : `${(km * 0.621).toFixed(km < 16 ? 1 : 0)} mi`)
const rowStyle = { width: '100%', background: 'none', border: 0, borderTop: '1px solid var(--line)', textAlign: 'left', cursor: 'pointer' } as const

/** Pick a saved course, find one near you or by name, or add one by hand. */
export function CoursePicker({ onPick, onClose }: { onPick: (c: Course) => void; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [dq, setDq] = useState('')
  const [adding, setAdding] = useState(false)
  const [area, setArea] = useState<Area>(loadArea)
  const [changing, setChanging] = useState(false)
  const [where, setWhere] = useState('')
  const [online, setOnline] = useState<{ candidates: CourseCandidate[]; errors: string[] } | null>(null)
  const [searching, setSearching] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const searchOn = dq.trim().length >= 3
  useEffect(() => { const t = setTimeout(() => setDq(q), 300); return () => clearTimeout(t) }, [q])
  const local = useData(() => api.courses(dq), [dq])

  // Online results for the current search text, or the courses near the chosen area. Stale answers are dropped.
  useEffect(() => {
    let live = true
    setSearching(true)
    const at = { lat: area.lat, lon: area.lon }
    ;(searchOn ? api.findCourses(dq, at) : api.nearCourses(at))
      .then((r) => live && setOnline(r))
      .catch((e) => live && setOnline({ candidates: [], errors: [(e as Error).message] }))
      .finally(() => live && setSearching(false))
    return () => { live = false }
  }, [dq, searchOn, area])

  const choose = (a: Area) => { setArea(a); saveArea(a); setChanging(false); setNote(null) }
  const useMyLocation = () => {
    setNote('Finding you…')
    if (!navigator.geolocation) return setNote('Location isn’t available here. Enter a ZIP or city.')
    navigator.geolocation.getCurrentPosition(
      (p) => choose({ label: 'you', lat: p.coords.latitude, lon: p.coords.longitude }),
      () => { setNote('Location is off for this app. Enter a ZIP or city instead.'); setChanging(true) },
      { timeout: 10_000, maximumAge: 600_000 },
    )
  }
  const findPlace = async () => {
    setNote('Looking up…')
    try { choose(await api.geocode(where)); setWhere('') } catch (e) { setNote((e as Error).message) }
  }
  const take = async (c: CourseCandidate) => {
    if (c.savedId) { const hit = local.data?.find((x) => x.id === c.savedId) ?? (await api.courses('')).find((x) => x.id === c.savedId); if (hit) { onPick(hit); onClose(); return } }
    setBusy(true)
    try { onPick(await api.importCourse(c)); onClose() }
    catch (e) { floater.set({ text: `Couldn't load that course. ${(e as Error).message}`, busy: false, error: true }) }
    finally { setBusy(false) }
  }
  const savedIds = new Set(local.data?.map((c) => c.id))
  const list = online?.candidates.filter((c) => !c.savedId || !savedIds.has(c.savedId)) ?? []

  return (
    <>
      <Sheet title="Course" tall onClose={onClose}>
        <div className="field"><input placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} enterKeyHint="search" /></div>
        {local.data?.map((c) => (
          <button key={c.id} className="row" style={rowStyle} onClick={() => { onPick(c); onClose() }}>
            <div className="grow">{c.name}<div className="cap">{[c.city, `${c.holes.length} holes · par ${parOf(c)}`, c.unverified ? 'check pars' : null].filter(Boolean).join(' · ')}</div></div>
          </button>
        ))}
        {local.data && !local.data.length && searchOn && <div className="note">No saved course matches “{dq}”.</div>}

        <div className="row" style={{ borderTop: '1px solid var(--line)' }}>
          <div className="grow" style={{ minWidth: 0 }}><span className="label">{searchOn ? 'Online matches' : `Near ${area.label.replace(/^Near /, '')}`}</span></div>
          <button className="txt quiet" style={{ background: 'none', border: 0, color: 'var(--accent)', minHeight: 44, padding: '0 8px' }} onClick={useMyLocation}>Use my location</button>
          <button className="txt quiet" style={{ background: 'none', border: 0, color: 'var(--accent)', minHeight: 44, padding: '0 8px' }} onClick={() => setChanging((v) => !v)}>Change</button>
        </div>
        {changing && (
          <div className="field" style={{ display: 'flex', gap: 8 }}>
            <input placeholder="ZIP or city" inputMode="text" enterKeyHint="go" value={where} onChange={(e) => setWhere(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && where.trim() && findPlace()} />
            <button className="btn" disabled={!where.trim()} onClick={findPlace}>Go</button>
          </div>
        )}
        {note && <div className="note">{note}</div>}
        {searching && <div className="note">{searchOn ? 'Searching…' : 'Finding courses nearby…'}</div>}
        {list.map((c) => (
          <button key={`${c.source}${c.externalId}`} className="row" disabled={busy} style={rowStyle} onClick={() => take(c)}>
            <div className="grow">{c.name}<div className="cap">{[mi(c.distanceKm), c.city, c.savedId ? 'saved' : null].filter(Boolean).join(' · ')}</div></div>
          </button>
        ))}
        {!searching && online && !list.length && !online.errors.length && <div className="note">{searchOn ? 'Nothing found. Try fewer words, or add it by hand.' : 'No courses found here yet. Try a nearby ZIP.'}</div>}
        {online?.errors.map((e) => <div key={e} className="note" style={{ color: 'var(--flag)' }}>{e}</div>)}
        <div style={{ padding: '12px 16px 0' }}><button className="btn block" onClick={() => setAdding(true)}>Add a course by hand</button></div>
      </Sheet>
      {adding && <CourseEditor onClose={() => setAdding(false)} onSaved={(c) => { onPick(c); onClose() }} />}
    </>
  )
}
