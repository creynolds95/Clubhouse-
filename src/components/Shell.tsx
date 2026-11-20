import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Icon } from './Icon'
import { useFloater, floater } from '../lib/floater'

export const TABS = [
  { to: '/', label: 'Home', icon: 'home' },
  { to: '/swings', label: 'Swings', icon: 'swing' },
  { to: '/rounds', label: 'Rounds', icon: 'rounds' },
  { to: '/practice', label: 'Practice', icon: 'practice' },
]
export const MENU = [
  { to: '/stats', label: 'Stats', icon: 'stats' },
  { to: '/courses', label: 'Courses', icon: 'rounds' },
  { to: '/r10', label: 'R10 sessions', icon: 'r10' },
  { to: '/import', label: 'Import', icon: 'plus' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
]

type Header = { title: string; back?: { label: string; to: string }; right?: ReactNode }
const HeaderCtx = createContext<(h: Header) => void>(() => {})

/** Screens declare their title bar. `back` turns the menu button into a named back control. */
export function useHeader(h: Header, deps: unknown[] = []) {
  const set = useContext(HeaderCtx)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => set(h), deps)
}

/** `?from=Label|/path` carries the origin so back can name it (same-app paths only). */
export function backFrom(search: string, fallback: { label: string; to: string }) {
  const raw = new URLSearchParams(search).get('from')
  if (!raw) return fallback
  const i = raw.indexOf('|')
  const label = raw.slice(0, i), to = raw.slice(i + 1)
  return i > 0 && to.startsWith('/') && !to.startsWith('//') ? { label, to } : fallback
}

export function Shell({ children }: { children: ReactNode }) {
  const [header, setHeader] = useState<Header>({ title: 'Clubhouse' })
  const [drawer, setDrawer] = useState(false)
  const loc = useLocation()
  const nav = useNavigate()
  const scroller = useRef<HTMLDivElement>(null)
  const scrollMemory = useRef(new Map<string, number>())
  const isTabRoot = TABS.some((t) => t.to === loc.pathname)

  // Scroll memory: restore on back (POP), otherwise start at top.
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const key = loc.pathname + loc.search
    const saved = scrollMemory.current.get(key)
    el.scrollTop = window.history.state?.usr?.restore && saved ? saved : 0
    const onScroll = () => scrollMemory.current.set(key, el.scrollTop)
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [loc.pathname, loc.search])

  useEffect(() => setDrawer(false), [loc.pathname])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawer(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Swipe right from the left 40%: back on pushed screens, open drawer on tab roots. >80px and dx > 2×dy.
  useEffect(() => {
    let sx = 0, sy = 0, tracking = false
    const start = (e: TouchEvent) => {
      const t = e.touches[0]
      const target = e.target as HTMLElement
      tracking = e.touches.length === 1 && t.clientX < window.innerWidth * 0.4 &&
        !target.closest('input,textarea,select,[data-no-swipe],[data-zoomable],dialog')
      sx = t.clientX; sy = t.clientY
    }
    const end = (e: TouchEvent) => {
      if (!tracking) return
      const t = e.changedTouches[0]
      const dx = t.clientX - sx, dy = Math.abs(t.clientY - sy)
      if (dx > 80 && dx > 2 * dy) {
        if (isTabRoot) setDrawer(true)
        else if (header.back) nav(header.back.to, { replace: true, state: { restore: true } })
      }
    }
    window.addEventListener('touchstart', start, { passive: true })
    window.addEventListener('touchend', end, { passive: true })
    return () => { window.removeEventListener('touchstart', start); window.removeEventListener('touchend', end) }
  }, [isTabRoot, header.back, nav])

  const navList = (onPick?: () => void) => (
    <>
      <div className="brand"><img src="/icons/crest.svg" alt="" />Clubhouse</div>
      {[...TABS, null, ...MENU].map((t, i) =>
        t ? (
          <NavLink key={t.to} to={t.to} end={t.to === '/'} replace className="navitem" onClick={onPick}>
            <Icon name={t.icon} size={20} />{t.label}
          </NavLink>
        ) : <div key={i} className="navdivider" />,
      )}
    </>
  )

  return (
    <HeaderCtx.Provider value={setHeader}>
      <div className="shell">
        <nav className="sidebar" aria-label="Main">{navList()}</nav>
        <div className="main">
          <header className="titlebar">
            <div className="left">
              {header.back ? (
                <Link className="iconbtn backbtn" to={header.back.to} replace state={{ restore: true }}>‹ {header.back.label}</Link>
              ) : (
                <button className="iconbtn menu" aria-label="Menu" onClick={() => setDrawer(true)}><Icon name="menu" /></button>
              )}
            </div>
            <h1>{header.title}</h1>
            <div className="right">{header.right}</div>
          </header>
          <div id="app-scroll" ref={scroller}>
            <div className="content">{children}</div>
          </div>
          <nav className="tabbar" aria-label="Tabs">
            {TABS.map((t) => (
              <NavLink key={t.to} to={t.to} end={t.to === '/'} replace
                onClick={() => { if (loc.pathname === t.to) scroller.current?.scrollTo({ top: 0, behavior: 'smooth' }) }}>
                <Icon name={t.icon} />{t.label}
              </NavLink>
            ))}
          </nav>
        </div>
        <div className={`backdrop${drawer ? ' open' : ''}`} onClick={() => setDrawer(false)} />
        <nav className={`drawer${drawer ? ' open' : ''}`} aria-label="Menu" aria-hidden={!drawer} inert={!drawer}
          onTouchStart={(e) => ((e.currentTarget as HTMLElement).dataset.sx = String(e.touches[0].clientX))}
          onTouchEnd={(e) => { const sx = Number((e.currentTarget as HTMLElement).dataset.sx); if (sx - e.changedTouches[0].clientX > 50) setDrawer(false) }}>
          {navList(() => setDrawer(false))}
        </nav>
        <Floater />
      </div>
    </HeaderCtx.Provider>
  )
}

function Floater() {
  const f = useFloater()
  if (!f) return null
  return (
    <div className="floater" role="status" aria-live="polite" onClick={() => f.error && floater.set(null)}>
      <div className="top">
        <span style={{ flex: 1 }}>{f.text}</span>
        {f.action && <button className="btn" style={{ minHeight: 36, background: 'transparent', color: 'inherit', borderColor: 'rgba(239,232,216,.4)' }} onClick={() => { floater.set(null); f.action!.run() }}>{f.action.label}</button>}
        {!f.busy && <button className="iconbtn" aria-label="Dismiss" onClick={() => floater.set(null)}><Icon name="close" size={18} /></button>}
      </div>
      {f.busy && <div className="bar"><i style={{ width: `${Math.round((f.progress ?? 0) * 100)}%` }} /></div>}
    </div>
  )
}
