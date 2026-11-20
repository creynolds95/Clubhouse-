import { useEffect, useState } from 'react'
import { useHeader } from '../components/Shell'
import { floater } from '../lib/floater'
import { api } from '../lib/api'
import { updateSettings } from '../lib/settings'
import { CLUB_CHOICES, MISS_CHOICES, type Profile as P } from '../../shared/types'

const numOrUndef = (v: string) => (v.trim() === '' ? undefined : Number(v))

export default function Profile() {
  useHeader({ title: 'Profile' })
  const [p, setP] = useState<P | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // Loaded once so a refresh on return to the app never wipes what is being typed.
  useEffect(() => { api.profile().then(setP).catch((e) => setErr(e.message)) }, [])
  if (err) return <div className="note" style={{ color: 'var(--flag)' }}>{err}</div>
  if (!p) return <div className="note">Loading…</div>
  const set = (patch: Partial<P>) => setP({ ...p, ...patch })
  const ft = p.heightIn ? Math.floor(p.heightIn / 12) : '', inch = p.heightIn ? Math.round(p.heightIn % 12) : ''
  const setHeight = (f: string, i: string) => set({ heightIn: f === '' && i === '' ? undefined : (Number(f) || 0) * 12 + (Number(i) || 0) })
  const toggle = (list: string[] | undefined, v: string) => (list?.includes(v) ? list.filter((x) => x !== v) : [...(list ?? []), v])
  const save = async () => {
    setSaving(true)
    try {
      const saved = await api.saveProfile(p)
      setP(saved)
      if (saved.handedness) updateSettings({ handedness: saved.handedness })
      floater.set({ text: 'Profile saved', busy: false })
    } catch (e) { floater.set({ text: `Couldn't save. ${(e as Error).message}`, busy: false, error: true }) }
    finally { setSaving(false) }
  }
  return (
    <>
      <div className="note">Everything here is optional. The coach reads it to tailor advice to your body and your game.</div>
      <div className="card">
        <h2>About you</h2>
        <div className="field"><span className="label">Height</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <input aria-label="Feet" inputMode="numeric" placeholder="ft" value={ft} onChange={(e) => setHeight(e.target.value, String(inch))} />
            <input aria-label="Inches" inputMode="numeric" placeholder="in" value={inch} onChange={(e) => setHeight(String(ft), e.target.value)} />
          </div></div>
        <div className="field"><span className="label">Weight (lb)</span><input inputMode="numeric" value={p.weightLb ?? ''} onChange={(e) => set({ weightLb: numOrUndef(e.target.value) })} /></div>
        <div className="field"><span className="label">Age</span><input inputMode="numeric" value={p.age ?? ''} onChange={(e) => set({ age: numOrUndef(e.target.value) })} /></div>
        <div className="field"><span className="label">Handedness</span>
          <div className="chips">{(['right', 'left'] as const).map((h) => <button key={h} className="chip" aria-pressed={p.handedness === h} onClick={() => set({ handedness: p.handedness === h ? undefined : h })}>{h === 'right' ? 'Right' : 'Left'}</button>)}</div></div>
      </div>
      <div className="card">
        <h2>Your game</h2>
        <div className="field"><span className="label">Handicap</span><input inputMode="decimal" value={p.handicap ?? ''} onChange={(e) => set({ handicap: numOrUndef(e.target.value) })} /></div>
        <div className="field"><span className="label">Typical miss</span>
          <div className="chips">{MISS_CHOICES.map((m) => <button key={m} className="chip" aria-pressed={p.typicalMiss === m} onClick={() => set({ typicalMiss: p.typicalMiss === m ? undefined : m })}>{m}</button>)}</div></div>
        <div className="field"><span className="label">Goals</span><textarea rows={3} placeholder="Break 90, hit more fairways…" value={p.goals ?? ''} onChange={(e) => set({ goals: e.target.value })} /></div>
      </div>
      <div className="card">
        <h2>Body</h2>
        <div className="field"><span className="label">Injuries or physical limits</span><textarea rows={3} placeholder="Lower back, limited hip turn…" value={p.limits ?? ''} onChange={(e) => set({ limits: e.target.value })} /></div>
      </div>
      <div className="card">
        <h2>Clubs in the bag</h2>
        <div className="field"><div className="chips">{CLUB_CHOICES.map((c) => <button key={c} className="chip" aria-pressed={!!p.clubs?.includes(c)} onClick={() => set({ clubs: toggle(p.clubs, c) })}>{c}</button>)}</div></div>
      </div>
      <div style={{ padding: '4px 16px 24px' }}><button className="btn block" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save profile'}</button></div>
    </>
  )
}
