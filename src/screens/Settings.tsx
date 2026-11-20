import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useHeader } from '../components/Shell'
import { Sheet } from '../components/Sheet'
import { floater } from '../lib/floater'
import { api } from '../lib/api'
import { useData } from '../lib/useData'
import { updateSettings, useSettings } from '../lib/settings'

export default function Settings() {
  useHeader({ title: 'Settings' })
  const s = useSettings()
  const ai = useData(api.aiStatus)
  const usage = useData(api.usage)
  const [confirm, setConfirm] = useState(false)
  const u = usage.data
  const choice = <T extends string>(value: T, opts: [T, string][], on: (v: T) => void) => (
    <div className="chips">{opts.map(([v, l]) => <button key={v} className="chip" aria-pressed={value === v} onClick={() => on(v)}>{l}</button>)}</div>
  )
  return (
    <>
      <div className="card">
        <h2>You</h2>
        <Link className="row" to="/profile?from=Settings|/settings"><div className="grow">Profile<div className="cap">Height, weight, age, miss, limits, goals, clubs. Helps the coach talk to you.</div></div></Link>
      </div>
      <div className="card">
        <h2>Swing</h2>
        <div className="field"><span className="label">Handedness</span>{choice(s.handedness, [['right', 'Right'], ['left', 'Left']], (v) => updateSettings({ handedness: v }))}</div>
        <div className="field"><span className="label">Default camera</span>{choice(s.defaultView, [['down_the_line', 'Down the line'], ['face_on', 'Face on']], (v) => updateSettings({ defaultView: v }))}</div>
      </div>
      <div className="card">
        <h2>Appearance</h2>
        <div className="field">{choice(s.theme, [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']], (v) => updateSettings({ theme: v }))}</div>
      </div>
      <div className="card">
        <h2>Storage</h2>
        <div className="field">
          <span className="label">Keep videos and raw files for</span>
          <div className="chips" role="radiogroup" aria-label="Retention">
            {[3, 7, 14, 30].map((d) => (
              <button key={d} className="chip" role="radio" aria-checked={u?.retentionDays === d} aria-pressed={u?.retentionDays === d}
                onClick={() => api.setRetention(d).then(usage.reload)}>{d} days</button>
            ))}
          </div>
        </div>
        <div className="note">Measurements, key frames and shot data are kept. Videos and Garmin files are deleted after this long.</div>
        <div className="row"><div className="grow">Requests today</div><div className="val" style={warn(u && u.requests.used / u.requests.limit)}>{u ? `${u.requests.used.toLocaleString()} / ${u.requests.limit.toLocaleString()}` : '—'}</div></div>
        <div className="row"><div className="grow">Database</div><div className="val" style={warn(u && u.d1.bytes / u.d1.limit)}>{u ? `${size(u.d1.bytes)} / ${size(u.d1.limit)}` : '—'}</div></div>
        <div className="row"><div className="grow">Videos and files</div><div className="val" style={warn(u && u.r2.bytes / u.r2.limit)}>{u ? `${size(u.r2.bytes)} / ${size(u.r2.limit)}` : '—'}</div></div>
        {u?.warnings.map((w) => <div key={w} className="note" style={{ color: 'var(--flag)' }}>{w}</div>)}
        <div className="row"><div className="grow">Last cleanup<div className="cap">Runs daily</div></div><div className="val">{u?.lastCleanup ? new Date(u.lastCleanup).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'Not yet'}</div></div>
        <div style={{ padding: '4px 16px 16px' }}><button className="btn block" onClick={() => setConfirm(true)}>Clean up now</button></div>
      </div>
      {confirm && (
        <Sheet title="Clean up now" onClose={() => setConfirm(false)}>
          <div className="note">This deletes videos and Garmin files older than {u?.retentionDays ?? 7} days. Measurements and key frames stay.</div>
          <div style={{ padding: '0 16px' }}>
            <button className="btn block danger" onClick={async () => {
              setConfirm(false)
              try { const r = await api.purgeNow(); floater.set({ text: `Removed ${r.videos} videos and ${r.files} files`, busy: false }); usage.reload() }
              catch (e) { floater.set({ text: `Cleanup failed. ${(e as Error).message}`, busy: false, error: true }) }
            }}>Delete old videos and files</button>
          </div>
        </Sheet>
      )}
      <div className="card">
        <h2>Coach</h2>
        <div className="row"><div className="grow">Status</div><div className="val">{ai.data ? (ai.data.enabled ? 'On' : 'Off') : '—'}</div></div>
        <div className="row"><div className="grow">Per-swing feedback</div><div className="val">{ai.data?.perClipModel ?? '—'}</div></div>
        <div className="row"><div className="grow">Weekly review + plan</div><div className="val">{ai.data?.weeklyModel ?? '—'}</div></div>
      </div>
      <div className="card">
        <div className="row"><div className="grow">Version</div><div className="val">{__APP_VERSION__}</div></div>
      </div>
    </>
  )
}

const size = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : b >= 1024 ** 2 ? `${(b / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)
const warn = (ratio?: number | null) => (ratio != null && ratio >= 0.8 ? { color: 'var(--flag)' } : undefined)
