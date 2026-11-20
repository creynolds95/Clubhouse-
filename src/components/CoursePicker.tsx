import { useEffect, useState } from 'react'
import { Sheet } from './Sheet'
import { CourseEditor } from './CourseEditor'
import { api } from '../lib/api'
import { floater } from '../lib/floater'
import { useData } from '../lib/useData'
import type { Course, CourseCandidate } from '../../shared/types'

export const parOf = (c: Course) => c.holes.reduce((s, h) => s + h.par, 0)

/** Pick a saved course, find one online (OpenStreetMap, GolfCourseAPI), or add one by hand. */
export function CoursePicker({ onPick, onClose }: { onPick: (c: Course) => void; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [dq, setDq] = useState('')
  const [adding, setAdding] = useState(false)
  const [online, setOnline] = useState<{ candidates: CourseCandidate[]; errors: string[] } | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { const t = setTimeout(() => setDq(q), 250); return () => clearTimeout(t) }, [q])
  const local = useData(() => api.courses(dq), [dq])
  useEffect(() => setOnline(null), [dq])

  const search = async () => {
    setBusy(true)
    try { setOnline(await api.findCourses(q)) }
    catch (e) { setOnline({ candidates: [], errors: [(e as Error).message] }) }
    finally { setBusy(false) }
  }
  const take = async (c: CourseCandidate) => {
    setBusy(true)
    try { onPick(await api.importCourse(c)); onClose() }
    catch (e) { floater.set({ text: `Couldn't load that course. ${(e as Error).message}`, busy: false, error: true }) }
    finally { setBusy(false) }
  }

  return (
    <>
      <Sheet title="Course" onClose={onClose}>
        <div className="field"><input placeholder="Search courses" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {local.data?.map((c) => (
          <button key={c.id} className="row" style={{ width: '100%', background: 'none', border: 0, borderTop: '1px solid var(--line)', textAlign: 'left', cursor: 'pointer' }}
            onClick={() => { onPick(c); onClose() }}>
            <div className="grow">{c.name}<div className="cap">{[c.city, `${c.holes.length} holes · par ${parOf(c)}`, c.unverified ? 'check pars' : null].filter(Boolean).join(' · ')}</div></div>
          </button>
        ))}
        {local.data && !local.data.length && <div className="note">No saved courses{dq ? ` match “${dq}”` : ' yet'}.</div>}
        {q.trim().length >= 3 && !online && (
          <div style={{ padding: '4px 16px' }}><button className="btn block" disabled={busy} onClick={search}>{busy ? 'Searching…' : 'Search online'}</button></div>
        )}
        {online?.candidates.map((c) => (
          <button key={`${c.source}${c.externalId}`} className="row" disabled={busy} style={{ width: '100%', background: 'none', border: 0, borderTop: '1px solid var(--line)', textAlign: 'left', cursor: 'pointer' }} onClick={() => take(c)}>
            <div className="grow">{c.name}<div className="cap">{[c.city, c.source === 'osm' ? 'OpenStreetMap' : 'GolfCourseAPI'].filter(Boolean).join(' · ')}</div></div>
          </button>
        ))}
        {online && !online.candidates.length && <div className="note">Nothing found online.</div>}
        {online?.errors.map((e) => <div key={e} className="note" style={{ color: 'var(--flag)' }}>{e}</div>)}
        <div style={{ padding: '12px 16px 0' }}><button className="btn block" onClick={() => setAdding(true)}>Add a course by hand</button></div>
      </Sheet>
      {adding && <CourseEditor onClose={() => setAdding(false)} onSaved={(c) => { onPick(c); onClose() }} />}
    </>
  )
}
