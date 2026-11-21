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

  const edge = '1.5px solid color-mix(in srgb, var(--text) 28%, transparent)'
  const lab: React.CSSProperties = { width: 70, flex: '0 0 70px', fontSize: 13, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--accent)', lineHeight: 1.15 }
  const line: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 }
  const chip = (on: boolean, label: React.ReactNode, onClick: () => void) => (
    <button className="chip" style={{ flex: 1, minHeight: 40, justifyContent: 'center', whiteSpace: 'nowrap', padding: '0 6px', fontSize: 15, ...(on ? {} : { background: 'var(--bg)', border: edge }) }} aria-pressed={on} onClick={onClick}>{label}</button>
  )
  const stepBtn: React.CSSProperties = { minHeight: 40, width: 56, padding: 0, fontSize: 26, fontWeight: 700, border: edge, background: 'var(--bg)' }
  const parPlayed = playedHoles.reduce((a, x) => a + x.par, 0)
  const rel = total - parPlayed
  const running = playedHoles.length ? (rel === 0 ? 'E' : rel > 0 ? `+${rel}` : `${rel}`) : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', margin: -16, minHeight: 'calc(var(--vv-h) - 64px - env(safe-area-inset-top))' }}>
      <div style={{ flex: '1 1 auto', display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingBottom: 4 }}>
      <div className="card" style={{ margin: '8px 16px 0', padding: '8px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div>
          <div style={{ fontSize: 34, fontWeight: 800, lineHeight: 1 }}>Par {h.par}</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>{[yds ? `${yds} yd` : 'No yardage', hcp && `Hcp ${hcp}`].filter(Boolean).join(' · ')}</div>
        </div>
        {running && <div style={{ textAlign: 'right' }}><div style={{ fontSize: 30, fontWeight: 800, lineHeight: 1, color: rel > 0 ? 'var(--c-clay)' : rel < 0 ? 'var(--c-green)' : 'var(--text)' }}>{running}</div><div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>through {playedHoles.length}</div></div>}
      </div>
      <div className="card" style={{ margin: '8px 16px 0', padding: 8, display: 'grid', gap: 6 }}>
        {h.par >= 4 && (
          <div style={line}><span style={lab}>Fairway</span>
            {(['left', 'hit', 'right'] as const).map((f) => chip(h.fairway === f, f === 'hit' ? 'Fairway' : f === 'left' ? '← Left' : 'Right →', () => set({ fairway: h.fairway === f ? undefined : f })))}</div>
        )}
        <div style={line}><span style={lab}>Green{h.gir == null && girAuto != null ? '*' : ''}</span>
          {([[true, 'Yes'], [false, 'No']] as const).map(([v, l]) => chip(gir === v, l, () => set({ gir: h.gir === v ? undefined : v })))}</div>
        {gir === false && (
          <div style={line}><span style={lab}>Up/down</span>
            {([[true, 'Yes'], [false, 'No']] as const).map(([v, l]) => chip(h.upDown === v, l, () => set({ upDown: h.upDown === v ? undefined : v })))}</div>
        )}
        <div style={line}><span style={lab}>Putts</span>
          <button className="btn" style={stepBtn} aria-label="Putts minus" onClick={() => set({ putts: h.putts == null || h.putts <= 0 ? undefined : h.putts - 1 })}>−</button>
          <div style={{ flex: 1, textAlign: 'center', fontSize: 30, fontWeight: 700 }}>{h.putts ?? '—'}</div>
          <button className="btn" style={stepBtn} aria-label="Putts plus" onClick={() => set({ putts: Math.min(15, (h.putts ?? -1) + 1) })}>+</button></div>
      </div>
      <div className="card" style={{ margin: '8px 16px 0', padding: 8, flex: '1 1 auto', maxHeight: 330, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--accent)' }}>Score</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gridAutoRows: 'minmax(34px, 1fr)', gap: 8, flex: 1 }}>
          {([['Eagle', -2], ['Birdie', -1], ['Par', 0], ['Bogey', 1], ['Double', 2], ['Triple', 3]] as const).map(([l, d]) => {
            const on = h.strokes === h.par + d && h.par + d > 0
            return (
              <button key={l} className="chip" style={{ fontSize: 15, fontWeight: 600, justifyContent: 'center', alignItems: 'center', flexDirection: 'column', gap: 0, lineHeight: 1.1, ...(on ? {} : { background: 'var(--bg)', border: edge }) }} aria-pressed={on}
                onClick={() => { const first = h.strokes === 0; set({ strokes: Math.max(1, h.par + d) }); if (first && s.idx < s.count - 1) setTimeout(() => go(s.idx + 1), 250) }}>
                <span style={{ display: 'block', fontSize: 22, fontWeight: 800 }}>{Math.max(1, h.par + d)}</span><span style={{ display: 'block' }}>{l}</span></button>
            )
          })}
        </div>
        <div style={line}>
          <span style={{ ...lab, flex: 1, width: 'auto' }}>Other</span>
          <button className="btn" style={{ ...stepBtn, minHeight: 40 }} aria-label="Score minus" onClick={() => set({ strokes: h.strokes <= 1 ? 0 : h.strokes - 1 })}>−</button>
          <div style={{ width: 44, textAlign: 'center', fontSize: 26, fontWeight: 700 }}>{h.strokes || '—'}</div>
          <button className="btn" style={{ ...stepBtn, minHeight: 40 }} aria-label="Score plus" onClick={() => set({ strokes: Math.min(15, (h.strokes || 0) + 1) })}>+</button>
        </div>
      </div>
      </div>
      <div style={{ position: 'sticky', bottom: 0, padding: '8px 16px calc(8px + env(safe-area-inset-bottom))', background: 'var(--bg)', borderTop: '1px solid var(--line)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, zIndex: 5 }}>
        <button className="btn primary" style={{ gridColumn: '1 / -1', minHeight: 42, fontSize: 17, fontWeight: 600 }} onClick={() => setChart(true)}>Club distances</button>
        <button className="btn primary" style={{ minHeight: 50, fontSize: 18, fontWeight: 600 }} disabled={s.idx === 0} onClick={() => go(s.idx - 1)}>‹ Back</button>
        {s.idx < s.count - 1 ? <button className="btn primary" style={{ minHeight: 50, fontSize: 18, fontWeight: 600 }} onClick={() => go(s.idx + 1)}>Next ›</button> : <button className="btn primary" style={{ minHeight: 50, fontSize: 18, fontWeight: 600 }} onClick={() => setDone(true)}>Finish</button>}
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
          <div style={{ padding: '0 16px 16px' }}><button className="btn block" onClick={() => { setGrid(false); setDone(true) }}>End round early</button></div>
        </Sheet>
      )}
      {chart && <Sheet title="Club distances" tall onClose={() => setChart(false)}><DistanceChart lookup={false} /></Sheet>}
    </div>
  )
}
