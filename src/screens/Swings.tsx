import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useHeader } from '../components/Shell'
import { Sheet } from '../components/Sheet'
import { Icon } from '../components/Icon'
import { api, shortDate } from '../lib/api'
import { useData } from '../lib/useData'
import { useSettings } from '../lib/settings'
import { processSwing } from '../lib/upload'

export const CLUBS = ['Driver', '3W', '5W', 'Hybrid', '4i', '5i', '6i', '7i', '8i', '9i', 'PW', 'GW', 'SW', 'LW']

export default function Swings() {
  const [params, setParams] = useSearchParams()
  const [adding, setAdding] = useState(params.get('new') === '1')
  useHeader({ title: 'Swings', right: <button className="iconbtn" aria-label="Add swing" onClick={() => setAdding(true)}><Icon name="plus" /></button> })
  const { data, loading, error, reload } = useData(api.swings)
  useEffect(() => { if (params.get('new')) setParams({}, { replace: true }) }, [params, setParams])

  return (
    <>
      {error && <div className="note">Couldn't load swings. {error}</div>}
      {loading && !data ? [0, 1, 2, 3].map((i) => <div key={i} className="skeleton" />) :
        !data?.length ? (
          <div className="empty"><div className="t">No swings yet.</div><div className="s">Film a 5-second clip, down the line or face on.</div>
            <button className="btn primary" style={{ marginTop: 20 }} onClick={() => setAdding(true)}>Add a swing</button></div>
        ) : (
          <div className="card">
            {data.map((s) => (
              <Link key={s.id} className="row chev" to={`/swings/${s.id}?from=Swings|/swings`}>
                {s.frames.includes('top')
                  ? <img src={`/api/swings/${s.id}/frames/top`} alt="" width={40} height={56} style={{ objectFit: 'cover', borderRadius: 6 }} loading="lazy" />
                  : <div style={{ width: 40, height: 56, borderRadius: 6, background: 'var(--line)' }} />}
                <div className="grow">{s.club ?? 'Swing'}
                  <div className="cap">{[shortDate(s.takenAt ?? s.createdAt), s.view === 'face_on' ? 'Face on' : s.view ? 'From behind' : null, s.metrics?.tempoRatio ? `tempo ${s.metrics.tempoRatio}:1` : null].filter(Boolean).join(' · ')}</div>
                </div>
              </Link>
            ))}
          </div>
        )}
      {adding && <AddSwing onClose={() => setAdding(false)} onSaved={reload} />}
    </>
  )
}

function AddSwing({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const settings = useSettings()
  const [club, setClub] = useState<string>('7i')
  const [view, setView] = useState(settings.defaultView)
  const [file, setFile] = useState<File | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const nav = useNavigate()

  return (
    <Sheet title="Add swing" onClose={onClose} saveLabel={file ? 'Save' : 'Save without video'}
      onSave={() => file
        ? processSwing(file, { club, view, handedness: settings.handedness }, (id) => { onSaved(); nav(`/swings/${id}?from=Swings|/swings`) })
        : api.createSwing({ club, view, takenAt: new Date().toISOString() }).then(({ id }) => { onSaved(); onClose(); nav(`/swings/${id}?from=Swings|/swings`) })}>
      <div className="field">
        <span className="label">Video (optional)</span>
        <input ref={input} type="file" accept="video/*" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <button className="btn block" onClick={() => input.current?.click()}>{file ? file.name : 'Choose or record a clip'}</button>
      </div>
      <div className="field">
        <span className="label">Club</span>
        <div className="chips">{CLUBS.map((c) => <button key={c} className="chip" aria-pressed={club === c} onClick={() => setClub(c)}>{c}</button>)}</div>
      </div>
      <div className="field">
        <span className="label">Camera</span>
        <div className="chips">
          <button className="chip" aria-pressed={view === 'down_the_line'} onClick={() => setView('down_the_line')}>From behind</button>
          <button className="chip" aria-pressed={view === 'face_on'} onClick={() => setView('face_on')}>Face on</button>
        </div>
      </div>
    </Sheet>
  )
}
