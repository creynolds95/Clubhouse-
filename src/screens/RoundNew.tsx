import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { backFrom, useHeader } from '../components/Shell'
import { api } from '../lib/api'
import { floater } from '../lib/floater'
import { CoursePicker, parOf } from '../components/CoursePicker'
import type { Course, HoleScore } from '../../shared/types'

const today = () => new Date().toLocaleDateString('en-CA')
const blank = (n: number): HoleScore[] => Array.from({ length: n }, (_, i) => ({ hole: i + 1, par: 4, strokes: 0, putts: undefined, fairway: undefined, gir: undefined }))

/** Quick entry: par / strokes / putts per hole, then fairway + GIR toggles. Clamping happens on save. */
export default function RoundNew() {
  const loc = useLocation()
  const nav = useNavigate()
  const back = backFrom(loc.search, { label: 'Rounds', to: '/rounds' })
  const [course, setCourse] = useState('')
  const [picked, setPicked] = useState<Course | null>(null)
  const [tee, setTee] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [playedOn, setPlayedOn] = useState(today())
  const [count, setCount] = useState<9 | 18>(18)
  const [holes, setHoles] = useState<HoleScore[]>(blank(18))
  const [saving, setSaving] = useState(false)
  const set = (i: number, patch: Partial<HoleScore>) => setHoles((hs) => hs.map((h, k) => (k === i ? { ...h, ...patch } : h)))
  const played = holes.slice(0, count)
  const valid = course.trim() && played.every((h) => h.strokes > 0)
  const total = played.reduce((s, h) => s + (h.strokes || 0), 0)

  const save = async () => {
    setSaving(true)
    try {
      await api.createRound({
        course: course.trim(), playedOn, tees: tee, source: 'manual',
        holes: played.map((h) => ({ ...h, par: Math.min(6, Math.max(3, h.par)), strokes: Math.min(15, Math.max(1, h.strokes)),
          gir: h.gir ?? (h.putts != null ? h.strokes - h.putts <= h.par - 2 : undefined) })),
      })
      floater.set({ text: `Round saved · ${total}`, busy: false })
      nav(back.to, { replace: true })
    } catch (e) { floater.set({ text: `Couldn't save round. ${(e as Error).message}`, busy: false, error: true }); setSaving(false) }
  }
  useHeader({ title: 'Log round', back, right: <button className="iconbtn" style={{ fontWeight: 600 }} disabled={!valid || saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button> }, [valid, saving, course, playedOn, holes, count])

  const num = (v: string) => (v === '' ? 0 : parseInt(v, 10) || 0)
  const usePicked = (c: Course) => {
    setPicked(c); setCourse(c.name); setTee(c.tees[0]?.name ?? null)
    const n = c.holes.length > 9 ? 18 : 9
    setCount(n)
    setHoles((hs) => hs.map((h, i) => (i < c.holes.length ? { ...h, par: c.holes[i].par } : h)))
  }
  return (
    <>
      <div className="card">
        <div className="field"><span className="label">Course</span>
          <button className="btn block" style={{ justifyContent: 'space-between' }} onClick={() => setPicking(true)}>
            <span>{course || 'Choose a course'}</span><span className="dim" style={{ color: 'var(--muted)' }}>{picked ? `Par ${parOf(picked)}` : ''}</span>
          </button>
        </div>
        {picked && picked.tees.length > 0 && (
          <div className="field"><span className="label">Tees</span>
            <div className="chips">{picked.tees.map((t) => (
              <button key={t.name} className="chip" aria-pressed={tee === t.name} onClick={() => setTee(tee === t.name ? null : t.name)}>
                {t.name}{t.totalYards ? ` · ${t.totalYards.toLocaleString()}` : ''}
              </button>
            ))}</div>
            {(() => { const t = picked.tees.find((x) => x.name === tee); return t && (t.rating || t.slope) ? <span className="cap" style={{ color: 'var(--muted)', fontSize: 13 }}>{[t.rating && `Rating ${t.rating}`, t.slope && `Slope ${t.slope}`].filter(Boolean).join(' · ')}</span> : null })()}
          </div>
        )}
        <label className="field"><span className="label">Date</span><input type="date" value={playedOn} onChange={(e) => setPlayedOn(e.target.value)} /></label>
        <div className="field"><span className="label">Holes</span>
          <div className="chips">{([9, 18] as const).map((n) => <button key={n} className="chip" aria-pressed={count === n} onClick={() => setCount(n)}>{n}</button>)}</div></div>
      </div>
      <div className="card">
        <h2>Scorecard · {total || '—'}</h2>
        <div className="holegrid" style={{ paddingTop: 4 }}><span className="h">#</span><span className="h">Par</span><span className="h">Score</span><span className="h">Putts</span></div>
        {played.map((h, i) => (
          <div key={h.hole}>
            <div className="holegrid">
              <span className="h">{h.hole}</span>
              <input inputMode="numeric" aria-label={`Hole ${h.hole} par`} value={h.par || ''} onFocus={(e) => setTimeout(() => e.target.select())} onChange={(e) => set(i, { par: num(e.target.value) })} />
              <input inputMode="numeric" aria-label={`Hole ${h.hole} score`} value={h.strokes || ''} onFocus={(e) => setTimeout(() => e.target.select())} onChange={(e) => set(i, { strokes: num(e.target.value) })} />
              <input inputMode="numeric" aria-label={`Hole ${h.hole} putts`} value={h.putts ?? ''} onFocus={(e) => setTimeout(() => e.target.select())} onChange={(e) => set(i, { putts: e.target.value === '' ? undefined : num(e.target.value) })} />
            </div>
            {h.par >= 4 && (
              <div className="chips" style={{ padding: '0 16px 10px 62px' }}>
                {(['left', 'hit', 'right'] as const).map((f) => (
                  <button key={f} className="chip" style={{ minHeight: 30, fontSize: 13 }} aria-pressed={h.fairway === f}
                    onClick={() => set(i, { fairway: h.fairway === f ? undefined : f })}>{f === 'hit' ? 'Fairway' : f === 'left' ? '← Miss' : 'Miss →'}</button>
                ))}
              </div>
            )}
          </div>
        ))}
        <div className="note">Greens in regulation are worked out from score and putts.</div>
      </div>
      {picking && <CoursePicker onClose={() => setPicking(false)} onPick={usePicked} />}
    </>
  )
}
