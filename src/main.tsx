import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import './styles.css'

registerSW({ immediate: true })

// On-screen keyboard: iOS shrinks only the visual viewport. Publish its size so the tab bar can hide and sheets can sit above the keyboard.
const vv = window.visualViewport
if (vv) {
  const html = document.documentElement
  const sync = () => {
    const below = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
    const open = below > 120
    html.classList.toggle('kb', open)
    html.style.setProperty('--vv-bottom', open ? `${below}px` : '0px')
    html.style.setProperty('--vv-h', `${vv.height}px`)
  }
  vv.addEventListener('resize', sync)
  vv.addEventListener('scroll', sync)
  sync()
  // Keep the field being typed in visible once the keyboard is up.
  document.addEventListener('focusin', (e) => {
    const t = e.target as HTMLElement
    if (t.matches('input, textarea, select')) setTimeout(() => t.scrollIntoView({ block: 'center', behavior: 'smooth' }), 350)
  })
}

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
