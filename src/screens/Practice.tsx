import { useHeader } from '../components/Shell'
import { api } from '../lib/api'
import { useData } from '../lib/useData'

export default function Practice() {
  useHeader({ title: 'Practice' })
  const ai = useData(api.aiStatus)
  return (
    <div className="empty">
      <div className="t">No plan this week.</div>
      <div className="s">
        {ai.data?.enabled
          ? 'Your weekly review builds a plan from your swings and rounds.'
          : 'Weekly plans start once the coach is connected. Keep adding swings and rounds until then.'}
      </div>
    </div>
  )
}
