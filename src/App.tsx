import { Route, Routes } from 'react-router-dom'
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
import Settings from './screens/Settings'

export default function App() {
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
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<div className="empty"><div className="t">Page not found.</div></div>} />
      </Routes>
    </Shell>
  )
}
