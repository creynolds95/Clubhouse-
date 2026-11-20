import { useHeader } from '../components/Shell'
import { api } from '../lib/api'
import { useData } from '../lib/useData'
import { updateSettings, useSettings } from '../lib/settings'

export default function Settings() {
  useHeader({ title: 'Settings' })
  const s = useSettings()
  const ai = useData(api.aiStatus)
  const choice = <T extends string>(value: T, opts: [T, string][], on: (v: T) => void) => (
    <div className="chips">{opts.map(([v, l]) => <button key={v} className="chip" aria-pressed={value === v} onClick={() => on(v)}>{l}</button>)}</div>
  )
  return (
    <>
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
