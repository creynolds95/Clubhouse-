import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { backFrom, useHeader } from '../components/Shell'
import { api, type LogRow } from '../lib/api'
import { useData } from '../lib/useData'

const NAME: Record<string, string> = {
  golfcourseapi: 'GolfCourseAPI', opengolf: 'OpenGolfAPI', nominatim: 'OSM search', overpass: 'OSM Overpass', zippopotam: 'ZIP lookup', anthropic: 'Coach (AI)',
}
const nameOf = (k: string) => NAME[k.split(':')[0]] ?? k
const OUTCOME: Record<LogRow['outcome'], { label: string; color?: string }> = {
  ok: { label: 'OK' }, cached: { label: 'Cached', color: 'var(--c-green)' }, skipped: { label: 'Skipped', color: 'var(--c-gold)' }, error: { label: 'Failed', color: 'var(--flag)' },
}
const time = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

/** Every call to an outside service: what it was for, the result, how long it took, and quota left. */
export default function ApiLog() {
  const loc = useLocation()
  useHeader({ title: 'Call log', back: backFrom(loc.search, { label: 'Settings', to: '/settings' }) }, [loc.search])
  const [filter, setFilter] = useState<string>('all')
  const { data, loading, error, reload } = useData(() => api.log(300))

  const [test, setTest] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  /** One honest request from this phone's browser to OpenGolfAPI: tells us whether it answers, and whether it allows browser requests (CORS). */
  const runTest = async () => {
    setTesting(true); setTest(null)
    const t0 = Date.now()
    let out: { outcome: 'ok' | 'error'; status?: number; note: string }
    try {
      const r = await fetch('https://api.opengolfapi.org/v1/courses/search?q=pecan&limit=1', { signal: AbortSignal.timeout(10_000) })
      const body = await r.text()
      out = r.ok ? { outcome: 'ok', status: r.status, note: `Answered with ${body.length} bytes` } : { outcome: 'error', status: r.status, note: `HTTP ${r.status}${/cloudflare|just a moment/i.test(body) ? ' (Cloudflare page)' : ''}` }
    } catch (e) {
      out = { outcome: 'error', note: (e as Error).name === 'TimeoutError' ? 'Timed out' : 'No answer the browser could read: blocked by CORS, or offline' }
    }
    const ms = Date.now() - t0
    setTest(out.outcome === 'ok' ? `Works from this phone (${ms} ms). ${out.note}.` : `Failed: ${out.note}.`)
    await api.logClient({ purpose: 'phone test: course search', outcome: out.outcome, status: out.status, ms, note: out.note }).catch(() => {})
    setTesting(false); reload()
  }

  if (loading && !data) return <><div className="skeleton" /><div className="skeleton" style={{ height: 240 }} /></>
  if (error || !data) return <div className="empty"><div className="t">Couldn't load the log.</div><div className="s">{error}</div></div>
  const g = data.golfCourseApi
  const rows = data.rows.filter((r) => filter === 'all' || (filter === 'problems' ? r.outcome === 'error' || r.outcome === 'skipped' : r.source === filter))
  const sources = [...new Set(data.rows.map((r) => r.source))]

  return (
    <>
      <div className="card">
        <h2>GolfCourseAPI today</h2>
        <div className="row"><div className="grow">Calls used<div className="cap">Our own cap, a few under their ~35/day free limit. Resets at midnight UTC.</div></div>
          <div className="val" style={g.usedToday >= g.budget ? { color: 'var(--flag)' } : undefined}>{g.keySet ? `${g.usedToday} / ${g.budget}` : 'No key set'}</div></div>
      </div>

      <div className="card">
        <h2>OpenGolfAPI from this phone</h2>
        <div className="note">One test request from this phone's browser, since the server's requests are blocked. Uses one OpenGolfAPI call, no GolfCourseAPI quota.</div>
        <div style={{ padding: '0 16px 12px' }}><button className="btn block" disabled={testing} onClick={runTest}>{testing ? 'Testing…' : 'Run one test'}</button></div>
        {test && <div className="note">{test}</div>}
      </div>

      {data.paused.length > 0 && (
        <div className="card">
          <h2>Paused</h2>
          <div className="note">These failed recently, so the app isn't calling them until the time shown. Nothing to do; they retry on their own.</div>
          {data.paused.map((p) => (
            <div key={p.key} className="row"><div className="grow">{nameOf(p.key)}{p.key.includes(':') ? ` (${p.key.split(':')[1]})` : ''}<div className="cap">{p.why} · until {time(p.until)}</div></div></div>
          ))}
        </div>
      )}

      <div className="card">
        <h2>Last 24 hours</h2>
        {!data.last24h.length ? <div className="note">No outside calls in the last day.</div> : data.last24h.map((s) => (
          <div key={s.source} className="row">
            <div className="grow">{nameOf(s.source)}
              <div className="cap">{[`${s.ok} ok`, s.cached ? `${s.cached} from cache` : null, s.skipped ? `${s.skipped} skipped` : null, s.errors ? `${s.errors} failed` : null, s.avg_ms != null ? `avg ${s.avg_ms} ms` : null].filter(Boolean).join(' · ')}</div>
            </div>
            <div className="val" style={s.errors ? { color: 'var(--flag)' } : undefined}>{s.total}</div>
          </div>
        ))}
      </div>

      <div className="chips" style={{ margin: '4px 0 8px' }}>
        {['all', 'problems', ...sources].map((f) => <button key={f} className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>{f === 'all' ? 'All' : f === 'problems' ? 'Problems' : nameOf(f)}</button>)}
      </div>
      <div className="card">
        {!rows.length ? <div className="note">Nothing here.</div> : rows.map((r) => {
          const o = OUTCOME[r.outcome]
          return (
            <div key={r.id} className="row" style={{ alignItems: 'flex-start' }}>
              <div className="grow">{nameOf(r.source)} · {r.purpose}
                <div className="cap">{[time(r.at), r.status != null ? (r.status === 0 ? 'no answer' : `HTTP ${r.status}`) : null, r.ms != null ? `${r.ms} ms` : null, r.quota_left != null ? `${r.quota_left} left today` : null, r.note].filter(Boolean).join(' · ')}</div>
              </div>
              <div className="val" style={o.color ? { color: o.color } : undefined}>{o.label}</div>
            </div>
          )
        })}
      </div>
      <div className="note">Kept 30 days. Only the service, purpose and result are stored: never keys or full addresses.</div>
      <div style={{ padding: '0 0 24px' }}><button className="btn block" onClick={reload}>Refresh</button></div>
    </>
  )
}
