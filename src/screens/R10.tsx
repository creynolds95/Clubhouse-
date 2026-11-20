import { useHeader } from '../components/Shell'

export default function R10() {
  useHeader({ title: 'R10 sessions' })
  return (
    <div className="empty">
      <div className="t">No R10 sessions yet.</div>
      <div className="s">Range sessions from the Garmin Golf app will show here, matched to your swing clips.</div>
    </div>
  )
}
