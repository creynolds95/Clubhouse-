import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { backFrom, useHeader } from '../components/Shell'
import { api } from '../lib/api'
import { floater } from '../lib/floater'
import { useData } from '../lib/useData'
import type { Course, CourseHole, CourseTee } from '../../shared/types'

interface Row { hole: number; par: number; yds?: number; hcp?: number }
const num = (v: string) => (v === '' ? undefined : parseInt(v.replace(/\D/g, ''), 10) || undefined)

/** Shrink a phone photo to a 1600px JPEG so it uploads quickly on course Wi-Fi or cell. */
async function shrink(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file)
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
  const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k)
  cv.getContext('2d')!.drawImage(bmp, 0, 0, cv.width, cv.height)
  return new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('Could not read that photo'))), 'image/jpeg', 0.85))
}

/** Scorecard for a course: photo of the card, which tees, and per-hole par, yardage and handicap. Entered by hand now; reading the photo turns on with the AI coach. */
export default function Scorecard() {
  const loc = useLocation(), nav = useNavigate()
  const [params, setParams] = useSearchParams()
  useHeader({ title: 'Scorecard', back: backFrom(loc.search, { label: 'Courses', to: '/courses' }) })
  const courses = useData(() => api.courses(''))
  const course = courses.data?.find((c) => c.id === params.get('course')) ?? null
  const ai = useData(api.aiStatus)
  const [tee, setTee] = useState('')
  const [newTee, setNewTee] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [photo, setPhoto] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const file = useRef<HTMLInputElement>(null)

  const load = (c: Course, teeName: string) => {
    const t = c.tees.find((x) => x.name === teeName)
    setRows(c.holes.map((h, i) => ({ hole: h.hole, par: h.par, hcp: h.hcp, yds: t?.yards?.[i] || undefined })))
  }
  useEffect(() => { if (course && !tee) { const first = course.tees[0]?.name ?? ''; setTee(first); load(course, first) } }, [course]) // eslint-disable-line react-hooks/exhaustive-deps
  // Plain URL so the browser cache (1 hour) is used; a new upload below adds a cache-buster.
  useEffect(() => { if (course && tee) { setPhoto(`/api/courses/${course.id}/scorecard?tee=${encodeURIComponent(tee)}`) } }, [course?.id, tee]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!course) return (
    <>
      <div className="note">Choose the course this scorecard is for.</div>
      <div className="card">{(courses.data ?? []).map((c) => <button key={c.id} className="row chev" style={{ width: '100%', background: 'none', border: 0, borderTop: '1px solid var(--line)', textAlign: 'left' }} onClick={() => setParams({ course: c.id }, { replace: true })}>{c.name}</button>)}</div>
      {courses.data && !courses.data.length && <div className="note">Save a course first from the Courses screen.</div>}
    </>
  )
  const pickTee = (name: string) => { setTee(name); load(course, name) }
  const set = (i: number, patch: Partial<Row>) => setRows((r) => r.map((x, k) => (k === i ? { ...x, ...patch } : x)))
  const total = rows.reduce((a, r) => a + (r.yds ?? 0), 0), par = rows.reduce((a, r) => a + r.par, 0)

  const onPhoto = async (f?: File) => {
    if (!f || !tee) return
    setBusy(true)
    try { await api.putScorecard(course.id, tee, await shrink(f)); setPhoto(`/api/courses/${course.id}/scorecard?tee=${encodeURIComponent(tee)}&t=${Date.now()}`); floater.set({ text: 'Photo saved', busy: false }) }
    catch (e) { floater.set({ text: `Couldn't save the photo. ${(e as Error).message}`, busy: false, error: true }) }
    finally { setBusy(false) }
  }
  const read = async () => { try { await api.readScorecard(course.id, tee) } catch (e) { floater.set({ text: (e as Error).message, busy: false }) } }
  const save = async () => {
    setBusy(true)
    try {
      const holes: CourseHole[] = rows.map((r) => ({ hole: r.hole, par: Math.min(6, Math.max(3, r.par || 4)), ...(r.hcp ? { hcp: r.hcp } : {}) }))
      const prev = course.tees.find((t) => t.name === tee)
      const next: CourseTee = { ...(prev ?? { name: tee }), name: tee, yards: rows.map((r) => r.yds ?? 0), totalYards: total || prev?.totalYards }
      const tees = prev ? course.tees.map((t) => (t.name === tee ? next : t)) : [...course.tees, next]
      await api.saveCourse({ id: course.id, name: course.name, city: course.city, state: course.state ?? 'TX', holes, tees })
      floater.set({ text: 'Scorecard saved', busy: false })
      courses.reload(); nav(-1)
    } catch (e) { floater.set({ text: `Couldn't save. ${(e as Error).message}`, busy: false, error: true }); setBusy(false) }
  }
  return (
    <>
      <div className="note"><b>{course.name}</b></div>
      <div className="card">
        <div className="field"><span className="label">Tees you play from</span>
          <div className="chips">{course.tees.map((t) => <button key={t.name} className="chip" aria-pressed={tee === t.name} onClick={() => pickTee(t.name)}>{t.name}</button>)}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <input placeholder="New tee, e.g. White" value={newTee} onChange={(e) => setNewTee(e.target.value)} style={{ flex: 1 }} />
            <button className="btn" disabled={!newTee.trim()} onClick={() => { const n = newTee.trim(); setNewTee(''); setTee(n); load(course, n) }}>Use</button>
          </div></div>
      </div>
      <div className="card">
        <h2>Scorecard photo</h2>
        {tee ? <>
          {photo && <img src={photo} alt={`${course.name} scorecard`} style={{ width: '100%', display: photo ? 'block' : 'none' }} onError={() => setPhoto(null)} />}
          <input ref={file} type="file" accept="image/*" capture="environment" hidden onChange={(e) => onPhoto(e.target.files?.[0])} />
          <div style={{ padding: '8px 16px 16px', display: 'grid', gap: 8 }}>
            <button className="btn block" disabled={busy} onClick={() => file.current?.click()}>{photo ? 'Replace photo' : 'Take or choose a photo'}</button>
            <button className="btn block" disabled={!photo || !ai.data?.enabled} onClick={read}>Read the photo{ai.data?.enabled ? '' : ' (turns on with the AI coach)'}</button>
          </div></> : <div className="note">Choose or add a tee first.</div>}
      </div>
      <div className="card">
        <h2>Holes · par {par}{total ? ` · ${total.toLocaleString()} yd` : ''}</h2>
        <div className="holegrid" style={{ gridTemplateColumns: '36px 1fr 1fr 1fr' }}><span className="h">#</span><span className="h">Par</span><span className="h">Yards</span><span className="h">Hcp</span></div>
        {rows.map((r, i) => (
          <div key={r.hole} className="holegrid" style={{ gridTemplateColumns: '36px 1fr 1fr 1fr', paddingBottom: 4 }}>
            <span className="h">{r.hole}</span>
            <input inputMode="numeric" aria-label={`Hole ${r.hole} par`} value={r.par || ''} onFocus={(e) => setTimeout(() => e.target.select())} onChange={(e) => set(i, { par: num(e.target.value) ?? 0 })} />
            <input inputMode="numeric" aria-label={`Hole ${r.hole} yards`} value={r.yds ?? ''} onFocus={(e) => setTimeout(() => e.target.select())} onChange={(e) => set(i, { yds: num(e.target.value) })} />
            <input inputMode="numeric" aria-label={`Hole ${r.hole} handicap`} value={r.hcp ?? ''} onFocus={(e) => setTimeout(() => e.target.select())} onChange={(e) => set(i, { hcp: num(e.target.value) })} />
          </div>
        ))}
      </div>
      <div style={{ padding: '4px 16px 24px' }}><button className="btn primary block" style={{ minHeight: 52 }} disabled={busy || !tee} onClick={save}>{busy ? 'Saving…' : 'Save scorecard'}</button></div>
    </>
  )
}
