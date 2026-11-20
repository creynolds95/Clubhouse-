import { useRef, useState } from 'react'
import { backFrom, useHeader } from '../components/Shell'
import { Sheet } from '../components/Sheet'
import { api, shortDate } from '../lib/api'
import { floater } from '../lib/floater'
import { useData } from '../lib/useData'
import { localDate, METRIC_LABEL, parseR10Csv, type R10Parse } from '../lib/r10'
import { useLocation, useNavigate } from 'react-router-dom'

interface Pending { file: File; importId: string; parse: R10Parse }

export default function Import() {
  const loc = useLocation()
  const nav = useNavigate()
  useHeader({ title: 'Import', back: backFrom(loc.search, { label: 'Home', to: '/' }) }, [loc.search])
  const input = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const history = useData(api.imports)
  const [busy, setBusy] = useState(false)

  const onFile = async (file: File) => {
    setBusy(true)
    try {
      const isCsv = /\.(csv|txt)$/i.test(file.name) || file.type.includes('csv')
      let parse: R10Parse | null = null
      if (isCsv) parse = parseR10Csv(await file.text(), localDate(new Date(file.lastModified || Date.now())))
      // Always keep the original so parsers can be improved and rerun without asking for the file again.
      const { id } = await api.uploadImport(file, file.name, parse ? 'r10' : 'other')
      if (parse) setPending({ file, importId: id, parse })
      else floater.set({ text: `${file.name} saved. I can't read this kind of file yet.`, busy: false })
    } catch (e) {
      floater.set({ text: `Import failed. ${(e as Error).message}`, busy: false, error: true })
    } finally { setBusy(false); if (input.current) input.current.value = '' }
  }

  const confirm = async () => {
    if (!pending) return
    try {
      const r = await api.importR10(pending.importId, pending.parse.shots)
      floater.set({ text: `${r.added} shots imported${r.duplicates ? ` · ${r.duplicates} already there` : ''}`, busy: false })
      nav('/r10', { replace: true })
    } catch (e) { floater.set({ text: `Import failed. ${(e as Error).message}`, busy: false, error: true }) }
  }

  return (
    <>
      <div className="card">
        <h2>R10 session</h2>
        <div className="note">In the Garmin Golf app, open Golf Sim Sessions, open a session and tap Share to get the CSV.</div>
        <div style={{ padding: '0 16px 16px' }}>
          <input ref={input} type="file" accept=".csv,.txt,.fit,.json,.zip" hidden onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          <button className="btn primary block" disabled={busy} onClick={() => input.current?.click()}>{busy ? 'Reading…' : 'Choose file'}</button>
        </div>
      </div>
      <div className="card">
        <h2>Scorecards</h2>
        <div className="note">Garmin has no scorecard export. Request your data from garmin.com/account/datamanagement, then choose the zip or any golf file from it here. I'll build the reader from it.</div>
      </div>
      <div className="card">
        <h2>Imported files</h2>
        {!history.data?.length
          ? <div className="note">Nothing imported yet.</div>
          : history.data.map((h) => (
            <div key={h.id} className="row"><div className="grow">{h.filename}<div className="cap">{shortDate(h.created_at)} · {h.kind === 'r10' ? `${h.rows_imported} shots` : 'saved'}</div></div></div>
          ))}
      </div>

      {pending && (
        <Sheet title="Import R10 session" saveLabel="Import" onClose={() => setPending(null)} onSave={confirm}>
          <div className="note" style={{ color: 'var(--text)' }}>
            {pending.parse.shots.length} shots · {new Set(pending.parse.shots.map((s) => s.sessionDate)).size} session(s)
            {pending.parse.skipped ? ` · ${pending.parse.skipped} blank rows skipped` : ''}
          </div>
          <div className="card" style={{ margin: '0 16px' }}>
            {pending.parse.mapped.map((m) => (
              <div key={m.header} className="row" style={{ minHeight: 40 }}><div className="grow cap">{m.header}</div><div className="val">{METRIC_LABEL[m.metric]}</div></div>
            ))}
          </div>
          <div className="note">Speeds are shown in mph and distances in yards. Columns in other units are converted.</div>
        </Sheet>
      )}
    </>
  )
}
