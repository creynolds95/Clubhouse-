import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useHeader } from '../components/Shell'
import { Spark } from '../components/Spark'
import { floater } from '../lib/floater'
import { api } from '../lib/api'
import { useData } from '../lib/useData'
import { clubInsights, clubsInData, gapNote } from '../lib/clubInsights'
import { CLUB_CHOICES } from '../../shared/types'

export default function Clubs() {
  useHeader({ title: 'Club insights' })
  const shots = useData(api.r10Shots), profile = useData(api.profile)
  const rows = useMemo(() => clubInsights(shots.data ?? []), [shots.data])
  const inData = useMemo(() => clubsInData(shots.data ?? []), [shots.data])
  const bag = profile.data?.clubs ?? []
  const missing = inData.filter((c) => !bag.includes(c))
  if (shots.loading && !shots.data) return <div className="skeleton" style={{ height: 240 }} />
  if (!rows.length) return (
    <div className="empty"><div className="t">Not enough range data yet.</div><div className="s">Import a session with at least 3 shots per club.</div>
      <Link className="btn primary" style={{ marginTop: 20 }} to="/import?from=Club insights|/clubs">Import a session</Link></div>
  )
  const addToBag = async () => {
    try {
      const merged = [...new Set([...bag, ...inData])].sort((a, b) => (CLUB_CHOICES as readonly string[]).indexOf(a) - (CLUB_CHOICES as readonly string[]).indexOf(b))
      await api.saveProfile({ ...(profile.data ?? {}), clubs: merged })
      profile.reload(); floater.set({ text: `Bag set: ${merged.length} clubs`, busy: false })
    } catch (e) { floater.set({ text: `Couldn't save. ${(e as Error).message}`, busy: false, error: true }) }
  }
  return (
    <>
      {missing.length > 0 && (
        <div className="card"><div className="note">Your data has {missing.length} {missing.length === 1 ? 'club' : 'clubs'} not in your bag yet: {missing.join(', ')}.</div>
          <div style={{ padding: '0 16px 16px' }}><button className="btn block" onClick={addToBag}>Add to my bag</button></div></div>
      )}
      <div className="label">Distance ladder</div>
      <div className="card" style={{ marginTop: 8 }}>
        {rows.map((r) => (
          <div key={r.club}>
            <div className="row">
              <div className="grow">{r.club}<div className="cap">{r.n} shots{r.carrySd != null ? ` · ±${r.carrySd}` : ''}{r.clubSpeed ? ` · ${r.clubSpeed} mph` : ''}</div></div>
              <div style={{ width: 70 }}><Spark values={r.trend} label={`${r.club} carry by session`} /></div>
              <div style={{ width: 64, textAlign: 'right' }}><b>{r.carry}</b><div className="cap">{r.delta == null ? 'carry' : `${r.delta > 0 ? '+' : ''}${r.delta}`}</div></div>
            </div>
            {r.gap != null && <div className="cap" style={{ padding: '0 16px 6px', color: gapNote(r.gap) ? 'var(--flag)' : undefined }}>↓ {r.gap} yd gap{gapNote(r.gap) ? ` · ${gapNote(r.gap)}` : ''}</div>}
          </div>
        ))}
      </div>
      <div className="label" style={{ marginTop: 16 }}>Miss pattern</div>
      <div className="card" style={{ marginTop: 8 }}>
        {rows.map((r) => <div key={r.club} className="row"><div className="grow">{r.club}</div><div className="val">{r.miss ?? 'needs spin and direction data'}</div></div>)}
      </div>
      <div className="note">Carry in yards, averaged per club. The small number under carry is the change since your previous session. Right and left are as seen from behind the ball.</div>
    </>
  )
}
