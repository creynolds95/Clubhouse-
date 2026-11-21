import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useHeader } from '../components/Shell'
import { Sheet } from '../components/Sheet'
import { Icon } from '../components/Icon'
import { api, frameSrc, shortDate } from '../lib/api'
import { useData } from '../lib/useData'
import { useSettings } from '../lib/settings'
import { bulk } from '../lib/bulk'

export const CLUBS = ['Driver', '3W', '5W', 'Hybrid', '4i', '5i', '6i', '7i', '8i', '9i', 'PW', 'GW', 'SW', 'LW']

export default function Swings() {
  const [params, setParams] = useSearchParams()
  const [adding, setAdding] = useState(params.get('new') === '1')
  useHeader({ title: 'Swings', right: <button className="iconbtn" aria-label="Add swing" onClick={() => setAdding(true)}><Icon name="plus" /></button> })
  const { data, loading, error, reload } = useData(api.swings)
  useEffect(() => bulk.onItemDone(reload), [reload])
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
                  ? <img src={frameSrc(s, 'top')} alt="" width={40} height={56} style={{ objectFit: 'cover', borderRadius: 6 }} loading="lazy" />
                  : <div style={{ width: 40, height: 56, borderRadius: 6, background: 'var(--line)' }} />}
                <div className="grow">{s.club ?? 'Swing'}
                  <div className="cap">{[shortDate(s.takenAt ?? s.createdAt), s.view === 'face_on' ? 'Face on' : s.view ? 'From behind' : null, s.metrics?.tempoRatio ? `tempo ${s.metrics.tempoRatio}:1` : null].filter(Boolean).join(' · ')}</div>
                </div>
              </Link>
            ))}
          </div>
        )}
      {adding && <AddSwing onClose={() => setAdding(false)} />}
    </>
  )
}

function AddSwing({ onClose }: { onClose: () => void }) {
  const settings = useSettings()
  const [files, setFiles] = useState<{ file: File; club: string }[]>([])
  const [view, setView] = useState(settings.defaultView)
  const input = useRef<HTMLInputElement>(null)
  const setClub = (i: number | null, club: string) => setFiles((fs) => fs.map((f, n) => (i === null || n === i ? { ...f, club } : f)))
  const pick = (list: FileList | null) => {
    if (!list?.length) return
    const last = files.at(-1)?.club ?? '7i'
    setFiles((fs) => [...fs, ...[...list].map((file) => ({ file, club: last }))])
  }

  return (
    <Sheet title="Add swings" onClose={onClose} saveLabel={files.length ? `Upload ${files.length}` : 'Choose videos'}
      onSave={async () => {
        if (!files.length) return
        bulk.add(files, view, settings.handedness)
        onClose()
      }}>
      <div className="field">
        <span className="label">Videos</span>
        <input ref={input} type="file" accept="video/*" multiple hidden onChange={(e) => { pick(e.target.files); e.target.value = '' }} />
        <button className="btn block" onClick={() => input.current?.click()}>{files.length ? 'Add more clips' : 'Choose or record clips'}</button>
      </div>
      {files.length > 1 && (
        <div className="field">
          <span className="label">All clips</span>
          <div className="chips">{CLUBS.map((c) => <button key={c} className="chip" aria-pressed={files.every((f) => f.club === c)} onClick={() => setClub(null, c)}>{c}</button>)}</div>
        </div>
      )}
      {files.map((f, i) => (
        <div className="field" key={`${f.file.name}${f.file.size}${i}`}>
          <span className="label" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.file.name}</span>
            <button className="iconbtn" aria-label="Remove clip" onClick={() => setFiles((fs) => fs.filter((_, n) => n !== i))}><Icon name="close" size={16} /></button>
          </span>
          <div className="chips">{CLUBS.map((c) => <button key={c} className="chip" aria-pressed={f.club === c} onClick={() => setClub(i, c)}>{c}</button>)}</div>
        </div>
      ))}
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
