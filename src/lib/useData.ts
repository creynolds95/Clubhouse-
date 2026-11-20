import { useCallback, useEffect, useState } from 'react'

/** Minimal fetch hook. Retries on foreground (iOS suspends fetches and never fires `online`). */
export function useData<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(() => {
    setLoading(true)
    load().then((d) => { setData(d); setError(null) }).catch((e) => setError(e.message)).finally(() => setLoading(false))
  }, deps)
  useEffect(() => {
    run()
    const onVis = () => document.visibilityState === 'visible' && run()
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('pageshow', onVis)
    return () => { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('pageshow', onVis) }
  }, [run])
  return { data, error, loading, reload: run }
}
