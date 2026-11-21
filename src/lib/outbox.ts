import { api, ApiError } from './api'
import type { Round } from '../../shared/types'

type Payload = Omit<Round, 'id' | 'total'> & { externalId: string }
const KEY = 'clubhouse.outbox'
const FAILED = 'clubhouse.outbox.rejected' // rounds the server refused (bad data); kept so nothing is lost
const read = (): Payload[] => { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') } catch { return [] } }
const write = (q: Payload[]) => { try { localStorage.setItem(KEY, JSON.stringify(q)) } catch { /* private mode */ } }

export const pending = () => read().length

const remove = (id: string) => write(read().filter((x) => x.externalId !== id))
const keepRejected = (p: Payload) => { try { localStorage.setItem(FAILED, JSON.stringify([...JSON.parse(localStorage.getItem(FAILED) ?? '[]'), p])) } catch { /* private mode */ } }

/** Try to send every queued round. The server ignores repeats of the same externalId, so retrying is safe. */
export async function flushOutbox() {
  for (const p of read()) {
    try { await api.createRound(p); remove(p.externalId) }
    catch (e) {
      if (e instanceof TypeError) return // offline: try again later
      // A round the server refuses would block the queue forever; set it aside and send the rest.
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) { keepRejected(p); remove(p.externalId); continue }
      return // server trouble: try again later
    }
  }
}

/** Save a finished round. Offline, it is kept on the phone and sent when the connection returns. Returns the server id when it was sent. */
export async function submitRound(p: Payload): Promise<{ sent: boolean; id?: string }> {
  try { const r = await api.createRound(p); return { sent: true, id: r.id } }
  catch (e) {
    if (e instanceof TypeError) { write([...read().filter((x) => x.externalId !== p.externalId), p]); return { sent: false } } // fetch throws TypeError when offline
    throw e
  }
}
