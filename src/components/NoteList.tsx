import { useState } from 'react'
import { dismiss, dismissed, type Note } from '../lib/clubNotes'

const color = { caution: 'var(--flag)', info: 'var(--muted)', use: 'var(--c-green)' } as const
const mark = { caution: '!', info: 'i', use: '→' } as const

/** Quiet, dismissible notes. A dismissed note stays hidden until the data behind it changes. */
export function NoteList({ notes, limit, showDrill }: { notes: Note[]; limit?: number; showDrill?: boolean }) {
  const [gone, setGone] = useState<string[]>(dismissed)
  const shown = notes.filter((n) => !gone.includes(n.id)).slice(0, limit)
  if (!shown.length) return null
  return (
    <div style={{ padding: '0 16px 8px', display: 'grid', gap: 8 }}>
      {shown.map((n) => (
        <div key={n.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 15 }}>
          <span aria-hidden style={{ color: color[n.tone], fontWeight: 800, width: 16, textAlign: 'center' }}>{mark[n.tone]}</span>
          <div style={{ flex: 1 }}>{n.text}{showDrill && n.drill && <div className="cap" style={{ color: 'var(--muted)', marginTop: 2 }}><b>{n.drill.title}.</b> {n.drill.how}</div>}</div>
          <button className="iconbtn" aria-label="Dismiss" style={{ minWidth: 32, minHeight: 32 }} onClick={() => { dismiss(n.id); setGone([...gone, n.id]) }}>×</button>
        </div>
      ))}
    </div>
  )
}
