import { useState } from 'react'
import { useHeader } from '../components/Shell'
import { Icon } from '../components/Icon'
import { CourseEditor } from '../components/CourseEditor'
import { CoursePicker, parOf } from '../components/CoursePicker'
import { api } from '../lib/api'
import { useData } from '../lib/useData'
import type { Course } from '../../shared/types'

export default function Courses() {
  const [find, setFind] = useState(false)
  const [edit, setEdit] = useState<Course | null>(null)
  useHeader({ title: 'Courses', right: <button className="iconbtn" aria-label="Add course" onClick={() => setFind(true)}><Icon name="plus" /></button> })
  const { data, loading, reload } = useData(() => api.courses())
  const src = useData(api.courseSources)
  if (loading && !data) return <>{[0, 1, 2].map((i) => <div key={i} className="skeleton" />)}</>
  return (
    <>
      {!data?.length ? (
        <div className="empty"><div className="t">No courses yet.</div><div className="s">Add the courses you play so pars fill in for you.</div>
          <button className="btn primary" style={{ marginTop: 20 }} onClick={() => setFind(true)}>Add a course</button></div>
      ) : (
        <div className="card">
          {data.map((c) => (
            <button key={c.id} className="row chev" style={{ width: '100%', background: 'none', border: 0, borderTop: '1px solid var(--line)', textAlign: 'left', cursor: 'pointer' }} onClick={() => setEdit(c)}>
              <div className="grow">{c.name}<div className="cap">{[c.city, `${c.holes.length} holes · par ${parOf(c)}`, c.unverified ? 'check pars' : null].filter(Boolean).join(' · ')}</div></div>
            </button>
          ))}
        </div>
      )}
      <div className="note">Online search: OpenStreetMap{src.data?.golfcourseapi ? ' and GolfCourseAPI' : ''}. {src.data && !src.data.golfcourseapi ? 'GolfCourseAPI is not connected.' : ''}</div>
      {find && <CoursePicker onClose={() => setFind(false)} onPick={() => reload()} />}
      {edit && <CourseEditor course={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload() }} />}
    </>
  )
}
