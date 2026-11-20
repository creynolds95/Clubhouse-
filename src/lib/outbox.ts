import { api } from './api'
import type { Round } from '../../shared/types'

type Payload = Omit<Round, 'id' | 'total'> & { externalId: string }
const KEY = 'clubhouse.outbox'
const read = (): Payload[] => { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') } catch { return [] } }
const write = (q: Payload[]) => { try { localStorage.setItem(KEY, JSON.stringify(q)) } catch { /* private mode */ } }

export const pending = () => read().length

/** Try to send every queued round. The server ignores repeats of the same externalId, so retrying is safe. */
export async function flushOutbox() {
  for (const p of read()) {
    try { await api.createRound(p); write(read().filter((x) => x.externalId !== p.externalId)) }
    catch (e) { if (!(e instanceof TypeError)) break; return } // offline: try again later
  }
}

/** Save a finished round. Offline, it is kept on the phone and sent when the connection returns. Returns whether it reached the server. */
export async function submitRound(p: Payload): Promise<boolean> {
  try { await api.createRound(p); return true }
  catch (e) {
    if (e instanceof TypeError) { write([...read().filter((x) => x.externalId !== p.externalId), p]); return false } // fetch throws TypeError when offline
    throw e
  }
}
