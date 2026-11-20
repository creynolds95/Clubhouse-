import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { backFrom, useHeader } from '../components/Shell'
import { CoursePicker } from '../components/CoursePicker'
import { DistanceChart } from '../components/DistanceChart'
import { Sheet } from '../components/Sheet'
import { floater } from '../lib/floater'
import { submitRound } from '../lib/outbox'
import { stashRound } from './RoundSummary'
import { holeYards, startPlay, usePlay } from '../lib/play'
import type { Course, HoleScore } from '../../shared/types'

const girOf = (x: HoleScore) => x.gir ?? (x.putts != null && x.strokes > 0 ? x.strokes - x.putts <= x.par - 2 : undefined)
const big: React.CSSProperties = { minHeight: 64, fontSize: 28, fontWeight: 700, flex: 1 }

function Stepper({ label, value, onChange, min = 0, max = 15, empty = '—' }: { label: string; value: number | undefined; onChange: (n: number | undefined) => void; min?: number; max?: number; empty?: string }) {
  return (
    <div className="field"><span className="label">{label}</span>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button className="btn" style={big} aria-label={`${label} minus`} onClick={() => onChange(value == null || value <= min ? undefined : value - 1)}>−</button>
        <div style={{ width: 72, textAlign: 'center', fontSize: 36, fontWeight: 700 }}>{value == null ? empty : value}</div>
        <button className="btn" style={big} aria-label={`${label} plus`} onClick={() => onChange(Math.min(max, (value ?? min - 1) + 1))}>+</button>
      </div>
    </div>
  )
}

/** On-course scoring: one hole per screen, big thumb targets, nothing needs a connection. */
export default function Play() {
  const loc = useLocation(), nav = useNavigate()
  const back = backFrom(loc.search, { label: 'Rounds', to: '/rounds' })
  const [s, setS] = usePlay()
  const [picking, setPicking] = useState(false)
  const [chart, setChart] = useState(false)
  const [done, setDone] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pick, setPick] = useState<{ course: Course; tee: string | null } | null>(null)
  const [grid, setGrid] = useState(false)
  useHeader({ title: s ? (done ? 'Round done' : `Hole ${s.idx + 1}`) : 'Play a round', back, right: s && !done ? <button className="iconbtn" style={{ fontWeight: 600 }} onClick={() => setGrid(true)}>All holes</button> : undefined }, [s?.idx, done, !!s])

  if (!s) {
    const c = pick?.course
    return (
      <>
        <div className="note">Set up before you leave signal range. The round is kept on this phone and sent when you're back online.</div>
        <div className="card">
          <div className="field"><span className="label">Course</span>
            <button className="btn block" onClick={() => setPicking(true)}>{c?.name ?? 'Choose a course'}</button></div>
          {c && c.tees.length > 0 && (
            <div className="field"><span className="label">Tees you're playing</span>
              <div className="chips">{c.tees.map((t) => <button key={t.name} className="chip" aria-pressed={pick?.tee === t.name} onClick={() => setPick({ course: c, tee: t.name })}>{t.name}{t.totalYards ? ` · ${t.totalYards.toLocaleString()}` : ''}</button>)}</div></div>
          )}
          {c && !c.tees.some((t) => t.yards?.some(Boolean)) && <div className="note">No hole yardages for this course yet. Scores still work. <Link to={`/scorecard?course=${c.id}&from=Play|/play`} style={{ textDecoration: 'underline' }}>Add the scorecard</Link></div>}
        </div>
        <div style={{ padding: '4px 16px' }}>
          <button className="btn primary block" disabled={!c} style={{ minHeight: 56 }} onClick={() => c && setS(startPlay(c, pick?.tee ?? c.tees[0]?.name ?? null, c.holes.length > 9 ? 18 : 9))}>Start round</button>
        </div>
        {picking && <CoursePicker onClose={() => setPicking(false)} onPick={(course) => setPick({ course, tee: course.tees[0]?.name ?? null })} />}
      </>
    )
  }

  const h = s.holes[s.idx]
  const hcp = s.course.holes[s.idx]?.hcp
  const yds = holeYards(s, s.idx)
  const set = (patch: Partial<HoleScore>) => setS({ ...s, holes: s.holes.map((x, i) => (i === s.idx ? { ...x, ...patch } : x)) })
  const go = (i: number) => setS({ ...s, idx: Math.max(0, Math.min(s.count - 1, i)) })
  const playedHoles = s.holes.filter((x) => x.strokes > 0)
  const total = playedHoles.reduce((a, x) => a + x.strokes, 0)
  const girAuto = h.putts != null && h.strokes > 0 ? h.strokes - h.putts <= h.par - 2 : undefined
  const gir = h.gir ?? girAuto

  const finish = async () => {
    setSaving(true)
    try {
      const payload = {
        externalId: s.id, course: s.course.name, playedOn: s.playedOn, tees: s.tee, source: 'manual' as const,
        holes: playedHoles.map((x) => ({ ...x, par: Math.min(6, Math.max(3, x.par)), strokes: Math.min(15, Math.max(1, x.strokes)), gir: girOf(x) })),
      }
      const { sent, id: serverId } = await submitRound(payload)
      const key = sent ? serverId! : `local-${s.id}`
      stashRound(key, { id: key, playedOn: payload.playedOn, course: payload.course, tees: payload.tees, holes: payload.holes, total, source: 'manual' })
      setS(null)
      floater.set({ text: sent ? `Round saved · ${total}` : `Saved on this phone · ${total}. Sends when you're online`, busy: false })
      nav(`/summary/${key}?from=Rounds|/rounds`, { replace: true })
    } catch (e) { floater.set({ text: `Couldn't save round. ${(e as Error).message}`, busy: false, error: true }); setSaving(false) }
  }

  if (done) {
    const par = playedHoles.reduce((a, x) => a + x.par, 0)
    const fw = playedHoles.filter((x) => x.par >= 4 && x.fairway && x.fairway !== 'na'), girs = playedHoles.filter((x) => girOf(x) != null)
    const putts = playedHoles.filter((x) => x.putts != null)
    return (
      <>
        <div className="card">
          <div className="row"><div className="grow">Score</div><div className="val" style={{ fontSize: 24 }}>{total || '—'}{total ? ` (${total - par >= 0 ? '+' : ''}${total - par})` : ''}</div></div>
          <div className="row"><div className="grow">Holes played</div><div className="val">{playedHoles.length}</div></div>
          <div className="row"><div className="grow">Fairways</div><div className="val">{fw.length ? `${Math.round((fw.filter((x) => x.fairway === 'hit').length / fw.length) * 100)}%` : '—'}</div></div>
          <div className="row"><div className="grow">Greens</div><div className="val">{girs.length ? `${Math.round((girs.filter((x) => girOf(x)).length / girs.length) * 100)}%` : '—'}</div></div>
          <div className="row"><div className="grow">Putts</div><div className="val">{putts.length ? putts.reduce((a, x) => a + (x.putts ?? 0), 0) : '—'}</div></div>
        </div>
        <div style={{ padding: '4px 16px', display: 'grid', gap: 10 }}>
          <button className="btn primary block" style={{ minHeight: 56 }} disabled={!playedHoles.length || saving} onClick={finish}>{saving ? 'Saving…' : 'Save round'}</button>
          <button className="btn block" onClick={() => setDone(false)}>Back to the holes</button>
          <button className="btn block danger" onClick={() => { if (confirm('Discard this round?')) { setS(null); nav('/rounds', { replace: true }) } }}>Discard round</button>
        </div>
      </>
    )
  }

  return (
    <>
      <div style={{ padding: '4px 16px 0' }}>
        <div style={{ fontSize: 44, fontWeight: 800, lineHeight: 1 }}>Par {h.par}</div>
        <div className="cap" style={{ fontSize: 16, color: 'var(--muted)' }}>{[yds && `${yds} yd`, hcp && `Hcp ${hcp}`, s.tee, `${total || 0} so far`].filter(Boolean).join(' · ')}</div>
        {!yds && <div className="cap" style={{ color: 'var(--muted)' }}>No yardage for this hole</div>}
      </div>
      <Stepper label="Putts" value={h.putts} onChange={(n) => set({ putts: n })} />
      {h.par >= 4 && (
        <div className="field"><span className="label">Fairway</span>
          <div className="chips">{(['left', 'hit', 'right'] as const).map((f) => <button key={f} className="chip" style={{ flex: 1, minHeight: 52 }} aria-pressed={h.fairway === f} onClick={() => set({ fairway: h.fairway === f ? undefined : f })}>{f === 'hit' ? 'Fairway' : f === 'left' ? '← Left' : 'Right →'}</button>)}</div></div>
      )}
      <div className="field"><span className="label">Green in regulation{h.gir == null && girAuto != null ? ' (worked out)' : ''}</span>
        <div className="chips">{([[true, 'Yes'], [false, 'No']] as const).map(([v, l]) => <button key={l} className="chip" style={{ flex: 1, minHeight: 52 }} aria-pressed={gir === v} onClick={() => set({ gir: h.gir === v ? undefined : v })}>{l}</button>)}</div></div>
      {gir === false && (
        <div className="field"><span className="label">Up and down?</span>
          <div className="chips">{([[true, 'Made it'], [false, 'No']] as const).map(([v, l]) => <button key={l} className="chip" style={{ flex: 1, minHeight: 52 }} aria-pressed={h.upDown === v} onClick={() => set({ upDown: h.upDown === v ? undefined : v })}>{l}</button>)}</div></div>
      )}
      <Stepper label="Penalties" value={h.penalties} onChange={(n) => set({ penalties: n })} max={6} empty="0" />
      <div className="field"><span className="label">Score · tap to save and move on</span>
        <div className="chips">
          {([['Eagle', -2], ['Birdie', -1], ['Par', 0], ['Bogey', 1], ['Double', 2], ['Triple', 3]] as const).map(([l, d]) => (
            <button key={l} className="chip" style={{ flex: '1 0 30%', minHeight: 56, fontSize: 18 }} aria-pressed={h.strokes === h.par + d && h.par + d > 0}
              onClick={() => { const first = h.strokes === 0; set({ strokes: Math.max(1, h.par + d) }); if (first && s.idx < s.count - 1) setTimeout(() => go(s.idx + 1), 250) }}>{l}<span style={{ opacity: 0.6, marginLeft: 6 }}>{Math.max(1, h.par + d)}</span></button>
          ))}
        </div></div>
      <Stepper label="Other score" value={h.strokes || undefined} onChange={(n) => set({ strokes: n ?? 0 })} min={1} />
      <div style={{ position: 'sticky', bottom: 0, padding: '10px 16px', background: 'var(--bg)', borderTop: '1px solid var(--line)', display: 'flex', gap: 10, zIndex: 5 }}>
        <button className="btn" style={{ ...big, fontSize: 20, flex: '0 0 auto', minWidth: 64 }} aria-label="Previous hole" disabled={s.idx === 0} onClick={() => go(s.idx - 1)}>‹</button>
        <button className="btn" style={{ ...big, fontSize: 20 }} onClick={() => setChart(true)}>Yards</button>
        {s.idx < s.count - 1 ? <button className="btn primary" style={{ ...big, fontSize: 20 }} onClick={() => go(s.idx + 1)}>Next ›</button> : <button className="btn primary" style={{ ...big, fontSize: 20 }} onClick={() => setDone(true)}>Finish</button>}
      </div>
      <div style={{ padding: '8px 16px 24px', display: 'grid', gap: 10 }}>
        <button className="btn block" onClick={() => setDone(true)}>End round</button>
      </div>
      {grid && (
        <Sheet title="All holes" onClose={() => setGrid(false)}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, padding: '4px 16px 16px' }}>
            {s.holes.map((x, i) => (
              <button key={x.hole} className="btn" style={{ minHeight: 72, flexDirection: 'column', gap: 2, outline: i === s.idx ? '3px solid var(--brass)' : undefined, background: x.strokes ? 'var(--tint)' : undefined, opacity: x.strokes || i === s.idx ? 1 : 0.7 }}
                onClick={() => { go(i); setGrid(false) }}>
                <span style={{ fontSize: 13, color: 'var(--muted)' }}>H{x.hole} · Par {x.par}</span>
                <span style={{ fontSize: 28, fontWeight: 800 }}>{x.strokes || '–'}</span>
              </button>
            ))}
          </div>
          <div className="note">Highlighted outline is the hole you're on. Grey dashes have no score yet.</div>
        </Sheet>
      )}
      {chart && <Sheet title="Club for the yardage" tall onClose={() => setChart(false)}><DistanceChart autoFocus /></Sheet>}
    </>
  )
}
