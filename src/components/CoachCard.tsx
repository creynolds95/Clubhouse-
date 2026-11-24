import { useState } from 'react'
import { api } from '../lib/api'
import { floater } from '../lib/floater'
import { useData } from '../lib/useData'

const read = (k: string): { text: string; at: string } | null => { try { return JSON.parse(localStorage.getItem(k) ?? 'null') } catch { return null } }

/** A coach answer that is generated on a tap, kept on the phone, and never re-requested unless asked. */
export function CoachCard({ title, cacheKey, run, label, deepRun, note }: {
  title: string; cacheKey: string; label: string
  run: () => Promise<string>
  /** Optional second button that uses the deeper model. */
  deepRun?: () => Promise<string>
  note?: string
}) {
  const ai = useData(api.aiStatus)
  const [hit, setHit] = useState(() => read(cacheKey))
  const [busy, setBusy] = useState(false)
  const go = async (fn: () => Promise<string>) => {
    setBusy(true)
    try {
      const text = await fn(); const v = { text, at: new Date().toISOString() }
      setHit(v); try { localStorage.setItem(cacheKey, JSON.stringify(v)) } catch { /* private mode */ }
    } catch (e) { floater.set({ text: (e as Error).message, busy: false, error: true }) }
    finally { setBusy(false) }
  }
  const on = ai.data?.enabled
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h2>{title}</h2>
      {hit && <div style={{ padding: '4px 16px 8px', whiteSpace: 'pre-wrap' }}>{hit.text}</div>}
      {hit && <div className="cap" style={{ padding: '0 16px 8px' }}>{new Date(hit.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}{note ? ` · ${note}` : ''}</div>}
      <div style={{ padding: '4px 16px 14px', display: 'grid', gap: 8 }}>
        <button className="btn block" disabled={busy || !on} onClick={() => go(run)}>{busy ? 'Thinking…' : hit ? 'Redo' : label}</button>
        {deepRun && <button className="btn block" disabled={busy || !on} onClick={() => go(deepRun)}>Go deeper (uses the stronger model, 3 a day)</button>}
        {ai.data && !on && <div className="cap">The coach is off.</div>}
      </div>
    </div>
  )
}
