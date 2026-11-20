import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** Bottom sheet (UX guide §6). Form sheets: Cancel · Title · Save. Dismiss: Esc, dim tap, drag header down. */
export function Sheet({ title, onClose, onSave, saveLabel = 'Save', saveDisabled, tall, children }: {
  tall?: boolean; title: string; onClose: () => void; onSave?: () => void; saveLabel?: string; saveDisabled?: boolean; children: ReactNode
}) {
  const [leaving, setLeaving] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const close = () => { setLeaving(true); setTimeout(onClose, 400) }

  useEffect(() => {
    const html = document.documentElement
    const prev = html.style.overflow
    html.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => { html.style.overflow = prev; window.removeEventListener('keydown', onKey) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Drag the header down: follows finger; closes past 1/3 height or on a flick.
  const drag = useRef<{ y: number; t: number } | null>(null)
  const onDown = (e: React.PointerEvent) => { drag.current = { y: e.clientY, t: performance.now() }; (e.target as HTMLElement).setPointerCapture(e.pointerId) }
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current || !ref.current) return
    const dy = Math.max(0, e.clientY - drag.current.y)
    ref.current.style.transform = `translateY(${dy}px)`
  }
  const onUp = (e: React.PointerEvent) => {
    if (!drag.current || !ref.current) return
    const dy = e.clientY - drag.current.y
    const v = dy / (performance.now() - drag.current.t)
    drag.current = null
    if (dy > ref.current.offsetHeight / 3 || (v > 0.6 && dy > 40)) close()
    else { ref.current.style.transition = 'transform .3s var(--ease)'; ref.current.style.transform = ''; setTimeout(() => ref.current && (ref.current.style.transition = ''), 300) }
  }

  // Portal to <body>: inside the page container a transformed ancestor would pin position:fixed to that box, leaving the tab bar showing.
  return createPortal(
    <>
      <div className={`sheet-dim${leaving ? ' leaving' : ''}`} onClick={close} />
      <div ref={ref} className={`sheet${tall ? ' tall' : ''}${leaving ? ' leaving' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
          {onSave ? <button className="txt quiet" onClick={close}>Cancel</button> : <span />}
          <h3>{title}</h3>
          <div className="r">
            {onSave
              ? <button className="txt" disabled={saveDisabled} onClick={() => { onSave(); close() }}>{saveLabel}</button>
              : <button className="txt quiet" aria-label="Close" onClick={close}>✕</button>}
          </div>
        </header>
        <div className="body">{children}</div>
      </div>
    </>,
    document.body,
  )
}
