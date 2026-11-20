import { useState } from 'react'
import { Sheet } from './Sheet'
import { api } from '../lib/api'
import { floater } from '../lib/floater'
import type { Course, CourseHole, CourseTee } from '../../shared/types'

const blank = (n: number): CourseHole[] => Array.from({ length: n }, (_, i) => ({ hole: i + 1, par: 4 }))
const num = (v: string) => (v === '' ? undefined : Number(v.replace(/[^\d.]/g, '')) || undefined)

/** Add or edit a course: name, 9 or 18 holes with par (and stroke index if known), and tees with rating, slope and yards. */
export function CourseEditor({ course, onClose, onSaved }: { course?: Course; onClose: () => void; onSaved: (c: Course) => void }) {
  const [name, setName] = useState(course?.name ?? '')
  const [city, setCity] = useState(course?.city ?? '')
  const [count, setCount] = useState<9 | 18>((course?.holes.length ?? 18) > 9 ? 18 : 9)
  const [holes, setHoles] = useState<CourseHole[]>(course?.holes.length ? [...course.holes, ...blank(18).slice(course.holes.length)] : blank(18))
  const [tees, setTees] = useState<CourseTee[]>(course?.tees ?? [])
  const played = holes.slice(0, count)
  const par = played.reduce((s, h) => s + h.par, 0)
  const setHole = (i: number, patch: Partial<CourseHole>) => setHoles((hs) => hs.map((h, k) => (k === i ? { ...h, ...patch } : h)))
  const setTee = (i: number, patch: Partial<CourseTee>) => setTees((ts) => ts.map((t, k) => (k === i ? { ...t, ...patch } : t)))

  const save = async () => {
    try {
      const id = await api.saveCourse({
        id: course?.id, name: name.trim(), city: city.trim() || null, state: course?.state ?? 'TX',
        holes: played.map((h) => ({ ...h, par: Math.min(6, Math.max(3, h.par || 4)) })),
        tees: tees.filter((t) => t.name.trim()),
      })
      onSaved({ id, name: name.trim(), city: city.trim() || null, state: course?.state ?? 'TX', source: course?.source ?? 'manual', holes: played, tees })
    } catch (e) { floater.set({ text: `Couldn't save course. ${(e as Error).message}`, busy: false, error: true }) }
  }

  return (
    <Sheet title={course ? 'Edit course' : 'Add course'} saveLabel="Save" saveDisabled={!name.trim()} onClose={onClose} onSave={save}>
      {course?.unverified && <div className="note" style={{ color: 'var(--flag)' }}>Some pars were missing from the source and are set to 4. Check them against the scorecard.</div>}
      <label className="field"><span className="label">Name</span><input data-sheet-focus value={name} onChange={(e) => setName(e.target.value)} placeholder="Course name" /></label>
      <label className="field"><span className="label">City</span><input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Optional" /></label>
      <div className="field"><span className="label">Holes</span>
        <div className="chips">{([9, 18] as const).map((n) => <button key={n} className="chip" aria-pressed={count === n} onClick={() => setCount(n)}>{n}</button>)}</div></div>
      <div className="label" style={{ padding: '4px 16px' }}>Par · {par}</div>
      <div className="holegrid" style={{ gridTemplateColumns: '40px 1fr 1fr' }}><span className="h">#</span><span className="h">Par</span><span className="h">Stroke index</span></div>
      {played.map((h, i) => (
        <div key={h.hole} className="holegrid" style={{ gridTemplateColumns: '40px 1fr 1fr', paddingBottom: 4 }}>
          <span className="h">{h.hole}</span>
          <input inputMode="numeric" aria-label={`Hole ${h.hole} par`} value={h.par || ''} onFocus={(e) => setTimeout(() => e.target.select())} onChange={(e) => setHole(i, { par: num(e.target.value) ?? 0 })} />
          <input inputMode="numeric" aria-label={`Hole ${h.hole} stroke index`} value={h.hcp ?? ''} onFocus={(e) => setTimeout(() => e.target.select())} onChange={(e) => setHole(i, { hcp: num(e.target.value) })} />
        </div>
      ))}
      <div className="label" style={{ padding: '12px 16px 4px' }}>Tees</div>
      {tees.map((t, i) => (
        <div key={i} className="holegrid" style={{ gridTemplateColumns: '1.4fr 1fr 1fr 1fr', paddingBottom: 6 }}>
          <input aria-label="Tee name" placeholder="Tee" value={t.name} onChange={(e) => setTee(i, { name: e.target.value })} style={{ textAlign: 'left', padding: '0 8px' }} />
          <input inputMode="decimal" aria-label="Rating" placeholder="Rating" value={t.rating ?? ''} onChange={(e) => setTee(i, { rating: num(e.target.value) })} />
          <input inputMode="numeric" aria-label="Slope" placeholder="Slope" value={t.slope ?? ''} onChange={(e) => setTee(i, { slope: num(e.target.value) })} />
          <input inputMode="numeric" aria-label="Yards" placeholder="Yards" value={t.totalYards ?? ''} onChange={(e) => setTee(i, { totalYards: num(e.target.value) })} />
        </div>
      ))}
      <div style={{ padding: '4px 16px 0' }}><button className="btn block" onClick={() => setTees((ts) => [...ts, { name: '' }])}>Add tee</button></div>
      {course && (
        <div style={{ padding: '24px 16px 0' }}>
          <button className="btn block danger" onClick={async () => { await api.deleteCourse(course.id); onClose(); onSaved({ ...course, id: '' }) }}>Delete course</button>
        </div>
      )}
    </Sheet>
  )
}
