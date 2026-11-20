import { useEffect } from 'react'
import { Route, Routes } from 'react-router-dom'
import { flushOutbox } from './lib/outbox'
import { Shell } from './components/Shell'
import Home from './screens/Home'
import Swings from './screens/Swings'
import SwingDetail from './screens/SwingDetail'
import Rounds from './screens/Rounds'
import RoundNew from './screens/RoundNew'
import Practice from './screens/Practice'
import Stats from './screens/Stats'
import R10 from './screens/R10'
import Import from './screens/Import'
import Courses from './screens/Courses'
import Settings from './screens/Settings'
import Profile from './screens/Profile'
import Clubs from './screens/Clubs'
import Play from './screens/Play'
import Distances from './screens/Distances'
import Warmup from './screens/Warmup'
import Scorecard from './screens/Scorecard'

export default function App() {
  // Send any round saved offline as soon as there is a connection again.
  useEffect(() => {
    const go = () => { flushOutbox() }
    go()
    window.addEventListener('online', go)
    document.addEventListener('visibilitychange', go)
    return () => { window.removeEventListener('online', go); document.removeEventListener('visibilitychange', go) }
  }, [])
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/swings" element={<Swings />} />
        <Route path="/swings/:id" element={<SwingDetail />} />
        <Route path="/rounds" element={<Rounds />} />
        <Route path="/rounds/new" element={<RoundNew />} />
        <Route path="/practice" element={<Practice />} />
        <Route path="/stats" element={<Stats />} />
        <Route path="/r10" element={<R10 />} />
        <Route path="/import" element={<Import />} />
        <Route path="/courses" element={<Courses />} />
        <Route path="/play" element={<Play />} />
        <Route path="/scorecard" element={<Scorecard />} />
        <Route path="/warmup" element={<Warmup />} />
        <Route path="/distances" element={<Distances />} />
        <Route path="/clubs" element={<Clubs />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<div className="empty"><div className="t">Page not found.</div></div>} />
      </Routes>
    </Shell>
  )
}
