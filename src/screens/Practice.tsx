import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useHeader } from '../components/Shell'
import { api } from '../lib/api'
import { useData } from '../lib/useData'
import { clubNotes } from '../lib/clubNotes'

export default function Practice() {
  useHeader({ title: 'Practice' })
  const ai = useData(api.aiStatus)
  const shots = useData(api.r10Shots)
  // One drill per pattern, grouped by club, so the list stays short.
  const fixes = useMemo(() => clubNotes(shots.data ?? []).filter((n) => n.tone === 'caution' && n.drill), [shots.data])
  return (
    <>
      <Link className="btn primary block" style={{ minHeight: 52 }} to="/warmup?from=Practice|/practice">Pre-round warm-up</Link>
      <div className="label" style={{ marginTop: 20 }}>Fix the inconsistencies</div>
      {fixes.length ? fixes.map((n) => (
        <div key={n.id} className="card" style={{ marginTop: 8 }}>
          <div className="row" style={{ display: 'block', padding: '12px 16px' }}>
            <div>{n.text}</div>
            <div style={{ marginTop: 6 }}><b>{n.drill!.title}.</b> <span style={{ color: 'var(--muted)' }}>{n.drill!.how}</span></div>
          </div>
        </div>
      )) : <div className="note">{shots.loading ? 'Checking your range data…' : 'Nothing flagged. Drills appear here when a club misses one way or its distance varies a lot (needs 8 or more shots with that club).'}</div>}
      <div className="note">{ai.data?.enabled ? 'The coach can tailor these to you.' : 'These are built-in drills picked from your range data. The coach will tailor them to your profile once it is connected.'}</div>
    </>
  )
}
