import { useCallback, useEffect, useRef, useState } from 'react'

/** Coming back to the app reloads data, but not more than once per this window (each load is a Worker request + D1 reads). */
const REFRESH_MS = 60_000

/** Minimal fetch hook. Retries on foreground (iOS suspends fetches and never fires `online`). */
export function useData<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const last = useRef(0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(() => {
    last.current = Date.now()
    setLoading(true)
    load().then((d) => { setData(d); setError(null) }).catch((e) => setError(e.message)).finally(() => setLoading(false))
  }, deps)
  useEffect(() => {
    run()
    // visibilitychange and pageshow often fire together; the window also stops a reload on every quick app switch.
    const onVis = () => document.visibilityState === 'visible' && Date.now() - last.current > REFRESH_MS && run()
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('pageshow', onVis)
    return () => { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('pageshow', onVis) }
  }, [run])
  return { data, error, loading, reload: run }
}
