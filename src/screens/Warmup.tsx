import { useMemo, useState } from 'react'
import { backFrom, useHeader } from '../components/Shell'
import { useLocation } from 'react-router-dom'
import { api } from '../lib/api'
import { useData } from '../lib/useData'
import { clubInsights } from '../lib/clubInsights'
import { clubNotes } from '../lib/clubNotes'

/** A short pre-round routine built from the player's own range numbers, plus the par-3 yardages of the course about to be played. */
export default function Warmup() {
  const loc = useLocation()
  useHeader({ title: 'Pre-round warm-up', back: backFrom(loc.search, { label: 'Practice', to: '/practice' }) })
  const shots = useData(api.r10Shots), courses = useData(() => api.courses(''))
  const [courseId, setCourseId] = useState<string | null>(null)
  const rows = useMemo(() => clubInsights(shots.data ?? []), [shots.data])
  const fixes = useMemo(() => clubNotes(shots.data ?? []).filter((n) => n.tone === 'caution' && n.drill).slice(0, 2), [shots.data])
  const course = courses.data?.find((c) => c.id === courseId)
  const has = (c: string) => rows.find((r) => r.club === c)
  const wedge = has('SW') ?? has('PW') ?? has('GW'), mid = has('7 Iron') ?? has('6 Iron') ?? has('8 Iron'), driver = has('Driver')
  const par3s = useMemo(() => {
    if (!course) return []
    const tee = course.tees.find((t) => t.yards?.some(Boolean)), res: { hole: number; yds: number; club: string }[] = []
    course.holes.forEach((h, i) => {
      const yds = tee?.yards?.[i]
      if (h.par === 3 && yds && rows.length) res.push({ hole: h.hole, yds, club: rows.reduce((a, b) => (Math.abs(b.carry - yds) < Math.abs(a.carry - yds) ? b : a)).club })
    })
    return res
  }, [course, rows])
  const step = (n: number, t: string, d: string) => <div key={n} className="row" style={{ display: 'block', padding: '12px 16px' }}><b>{n}. {t}</b><div style={{ color: 'var(--muted)' }}>{d}</div></div>
  return (
    <>
      <div className="note">About 25 minutes. Built from your range numbers.</div>
      <div className="card">
        {step(1, 'Loosen up (3 min)', 'Hip and shoulder turns, a few easy swings with a short club. Nothing hard yet.')}
        {step(2, 'Wedges', wedge ? `5 balls with your ${wedge.club}, easy pace, around ${Math.round(wedge.carry * 0.75)} to ${wedge.carry} yds. Pick a target.` : '5 balls with a wedge, easy pace.')}
        {step(3, 'Mid iron', mid ? `5 balls with your ${mid.club} at ${mid.carry}. Aim for a smooth, repeatable tempo.` : '5 balls with a mid iron.')}
        {step(4, 'Driver', driver ? `3 balls, full swing. You carry about ${driver.carry}${driver.carrySd ? ` (±${driver.carrySd})` : ''}.` : '3 balls, full swing.')}
        {fixes.map((f, i) => step(5 + i, `Fix: ${f.club ?? 'tendency'}`, `${f.drill!.title}. ${f.drill!.how}`))}
        {step(5 + fixes.length, 'Putting (8 min)', '10 putts from 3 feet, then 5 lag putts from 30 feet. Learn the green speed.')}
      </div>
      <div className="label" style={{ marginTop: 16 }}>Today's course</div>
      <div className="chips" style={{ margin: '8px 16px' }}>
        {(courses.data ?? []).slice(0, 12).map((c) => <button key={c.id} className="chip" aria-pressed={courseId === c.id} onClick={() => setCourseId(courseId === c.id ? null : c.id)}>{c.name}</button>)}
        {!courses.data?.length && <div className="note">Save a course to see its par 3s here.</div>}
      </div>
      {course && (par3s.length ? (
        <div className="card">{par3s.map((p) => <div key={p.hole} className="row"><div className="grow">Hole {p.hole} · {p.yds} yd</div><div className="val">{p.club}</div></div>)}</div>
      ) : <div className="note">No par 3 yardages for this course yet. Add a scorecard or yardages to see which clubs to rehearse.</div>)}
      {par3s.length > 0 && <div className="note">Rehearse the clubs you'll need on the par 3s.</div>}
    </>
  )
}
