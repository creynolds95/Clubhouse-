import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import './styles.css'

registerSW({ immediate: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)

// Fade the static splash once mounted, held for a minimum visible time so it never flashes.
const SPLASH_MIN_MS = 700
const start = performance.now()
setTimeout(() => {
  const s = document.getElementById('splash')
  if (!s) return
  s.classList.add('gone')
  setTimeout(() => s.remove(), 600)
}, Math.max(0, SPLASH_MIN_MS - start))
