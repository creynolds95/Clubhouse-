import type { Profile, Swing } from '../shared/types'
import { call } from './outbound'

/**
 * Coach interface. OFF until the final "turn it on" step. Two switches, both required:
 *   - AI_ENABLED = "true" (wrangler.jsonc var or dashboard)
 *   - `wrangler secret put ANTHROPIC_API_KEY`
 * Then implement ClaudeCoach with the official @anthropic-ai/sdk, following AI_RULES below.
 */
export interface AiEnv {
  AI_ENABLED?: string
  AI_PER_CLIP_MODEL?: string
  /** Deeper review model. Name kept for existing dashboard vars; it is NOT run weekly by default. */
  AI_WEEKLY_MODEL?: string
  ANTHROPIC_API_KEY?: string
  DB?: D1Database
}

/**
 * Cost rules every coach call must follow. Haiku does the routine work; Sonnet only when you ask for a deeper look.
 * Prices (per 1M tokens, Nov 2026): Haiku 5.5 $0.10 in / $0.50 out, Sonnet 5.5 $2 in / $10 out.
 * A per-clip call (4 frames at 720px ≈ 1.6k image tokens + ~1k text + 400 out) costs well under $0.001 on Haiku.
 */
export const AI_RULES = {
  /** Per swing clip, scorecard photo reading, after-round write-up, warm-up suggestions. */
  routine: { model: 'claude-haiku-5-5', maxOutputTokens: 600, effort: 'low' as const },
  /** Only on an explicit tap ("Deeper review"). Never on a schedule, never as an automatic retry of Haiku. */
  deep: { model: 'claude-sonnet-5-5', maxOutputTokens: 2000, effort: 'medium' as const },
  /** Key frames sent per clip: address, top, impact, finish. Frames are stored at 720px max, so no resizing needed. */
  framesPerClip: ['address', 'top', 'impact', 'finish'] as const,
  /** Hard daily caps, counted from the api_log table (source = anthropic). Calls past the cap are refused, not queued. */
  dailyCap: { routine: 40, deep: 3 },
  /** One SDK retry at most (maxRetries: 1) and a 60 s timeout. No app-level retry loops. */
  maxRetries: 1,
  timeoutMs: 60_000,
  /** Cache the fixed system prompt (coaching rules + profile) with cache_control; volatile data goes after it. */
  cacheSystemPrompt: true,
  /** Nothing calls the coach from the cron job. Every call starts from a tap in the app. */
  scheduled: false,
}
export type AiKind = 'routine' | 'deep'

export const aiStatus = (env: AiEnv) => ({
  enabled: env.AI_ENABLED === 'true' && !!env.ANTHROPIC_API_KEY,
  perClipModel: env.AI_PER_CLIP_MODEL ?? AI_RULES.routine.model,
  weeklyModel: env.AI_WEEKLY_MODEL ?? AI_RULES.deep.model,
  dailyCap: AI_RULES.dailyCap,
})

export class CoachOffError extends Error {
  constructor(msg = 'The coach is not connected yet') { super(msg) }
}

/**
 * Gate in front of every coach call: AI must be switched on and today's cap for this kind of call not reached.
 * Each call must then be logged to api_log with source 'anthropic' and purpose starting "routine:" or "deep:".
 */
export async function aiAllowed(env: AiEnv, kind: AiKind): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!aiStatus(env).enabled) return { ok: false, reason: 'The coach is off.' }
  if (!env.DB) return { ok: false, reason: 'No database to count coach calls.' }
  const since = new Date().toISOString().slice(0, 10)
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM api_log WHERE source = 'anthropic' AND outcome IN ('ok', 'error') AND purpose LIKE ? AND at >= ?")
    .bind(`${kind}:%`, since).first<{ n: number }>()
  const cap = AI_RULES.dailyCap[kind]
  return (row?.n ?? 0) >= cap ? { ok: false, reason: `Today's ${kind === 'deep' ? 'deeper review' : 'coach'} limit (${cap}) is used. It resets at midnight UTC.` } : { ok: true }
}

export interface ClipInput { profile?: Profile; swing: Swing; frames: { phase: string; jpeg: ArrayBuffer }[] }
/** Deeper review on request (Sonnet): recent swings, rounds and strokes lost. */
export interface DeepReviewInput { profile?: Profile; swings: Swing[]; rounds: unknown[] }
export interface Coach {
  clipFeedback(input: ClipInput): Promise<string>
  deepReview(input: DeepReviewInput): Promise<{ summary: string; plan: unknown }>
}

export function getCoach(env: AiEnv): Coach {
  if (!aiStatus(env).enabled) throw new CoachOffError()
  throw new CoachOffError() // ClaudeCoach lands in the final step. Until then nothing can reach the API.
}

/** The player's profile as plain text for the top of a coach prompt. Empty when nothing is filled in. */
export function profilePrompt(p?: Profile | null): string {
  if (!p) return ''
  const lines: string[] = []
  const ft = p.heightIn ? `${Math.floor(p.heightIn / 12)}'${Math.round(p.heightIn % 12)}"` : null
  const body = [ft && `height ${ft}`, p.weightLb && `${p.weightLb} lb`, p.age && `age ${p.age}`, p.handedness && `${p.handedness}-handed`].filter(Boolean)
  if (body.length) lines.push(`Player: ${body.join(', ')}.`)
  if (p.handicap != null) lines.push(`Handicap: ${p.handicap}.`)
  if (p.typicalMiss) lines.push(`Typical miss: ${p.typicalMiss}.`)
  if (p.limits?.trim()) lines.push(`Physical limits or injuries: ${p.limits.trim()}. Do not suggest moves that stress these.`)
  if (p.goals?.trim()) lines.push(`Goals: ${p.goals.trim()}.`)
  if (p.clubs?.length) lines.push(`Clubs in the bag: ${p.clubs.join(', ')}.`)
  return lines.length ? `About the player (use it to tailor tone and advice to their body):\n${lines.join('\n')}` : ''
}

/**
 * One tiny Haiku call to prove the key works. Counts against the daily routine cap and shows in the call log.
 * Works before the coach is switched on (it only needs the key), so the key can be checked first.
 */
export async function aiTest(env: AiEnv): Promise<{ ok: boolean; message: string }> {
  if (!env.ANTHROPIC_API_KEY) return { ok: false, message: 'No key yet. Add ANTHROPIC_API_KEY as a Worker secret.' }
  if (!env.DB) return { ok: false, message: 'No database.' }
  const since = new Date().toISOString().slice(0, 10)
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM api_log WHERE source = 'anthropic' AND outcome IN ('ok', 'error') AND purpose LIKE 'routine:%' AND at >= ?").bind(since).first<{ n: number }>()
  if ((row?.n ?? 0) >= AI_RULES.dailyCap.routine) return { ok: false, message: `Today's limit (${AI_RULES.dailyCap.routine}) is used.` }
  const model = env.AI_PER_CLIP_MODEL ?? AI_RULES.routine.model
  try {
    const res = await call(env as { DB: D1Database }, { source: 'anthropic', purpose: 'routine: connection test', ignorePause: true, timeoutMs: 20_000 }, 'https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 16, messages: [{ role: 'user', content: 'Reply with the single word: ready' }] }),
    })
    const body = await res.json().catch(() => ({})) as { content?: { text?: string }[]; error?: { message?: string } }
    if (!res.ok) return { ok: false, message: `Anthropic answered ${res.status}: ${body.error?.message ?? 'no detail'}` }
    return { ok: true, message: `Works. ${model} replied "${(body.content?.[0]?.text ?? '').trim().slice(0, 40)}".` }
  } catch (e) { return { ok: false, message: `Couldn't reach Anthropic (${(e as Error).message}).` } }
}

// ---------------------------------------------------------------------------
// Coach calls. Every one goes through claude(): gated by the switch and the daily cap, logged as source "anthropic".
// Haiku does the everyday work. Sonnet runs only when the player asks for a deeper review.
// ---------------------------------------------------------------------------
export class CoachBlocked extends Error { override name = 'CoachBlocked' }

const b64 = (buf: ArrayBuffer) => {
  const u = new Uint8Array(buf); let s = ''
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000))
  return btoa(s)
}
export const imageBlock = (jpeg: ArrayBuffer) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64(jpeg) } })

async function claude(env: AiEnv, kind: AiKind, purpose: string, system: string, content: unknown[], maxTokens: number): Promise<string> {
  const gate = await aiAllowed(env, kind)
  if (!gate.ok) throw new CoachBlocked(gate.reason)
  const model = kind === 'deep' ? (env.AI_WEEKLY_MODEL ?? AI_RULES.deep.model) : (env.AI_PER_CLIP_MODEL ?? AI_RULES.routine.model)
  const logPurpose = `${kind}: ${purpose}`
  // A failed or empty reply is relabelled "void:" in the log so it does not use up the daily cap.
  const voidLast = () => env.DB!.prepare("UPDATE api_log SET purpose = 'void: ' || purpose, note = COALESCE(note, 'did not count against the cap') WHERE id = (SELECT MAX(id) FROM api_log WHERE source = 'anthropic' AND purpose = ?)").bind(logPurpose).run().catch(() => {})
  let thinkingOff = true, tokens = maxTokens, emptyTries = 0
  for (;;) {
    let res: Response
    try {
      res = await call(env as { DB: D1Database }, { source: 'anthropic', purpose: logPurpose, timeoutMs: AI_RULES.timeoutMs }, 'https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': env.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        // Thinking is switched off: it can eat the whole token budget and leave no text. These are short answers.
        body: JSON.stringify({ model, max_tokens: tokens, system, messages: [{ role: 'user', content }], ...(thinkingOff ? { thinking: { type: 'disabled' } } : {}) }),
      })
    } catch (e) { await voidLast(); throw new CoachBlocked(`Couldn't reach the coach (${(e as Error).message}).`) }
    const body = await res.json().catch(() => ({})) as { content?: { type: string; text?: string }[]; stop_reason?: string; error?: { message?: string } }
    if (!res.ok) {
      await voidLast()
      if (res.status === 400 && thinkingOff && /thinking/i.test(body.error?.message ?? '')) { thinkingOff = false; continue }
      throw new CoachBlocked(`The coach answered ${res.status}${body.error?.message ? `: ${body.error.message}` : ''}`)
    }
    const text = (body.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').trim()
    if (text) return text
    await voidLast()
    if (emptyTries++ === 0) { tokens = Math.min(tokens * 2, 4000); continue } // one retry with more room
    throw new CoachBlocked(`The coach sent back nothing (${body.stop_reason ?? 'no reason given'}). Try again.`)
  }
}

const STYLE = 'Write plainly for a golfer with a single-digit to mid-handicap game. No praise or filler. Short sentences. Practical, specific, and tied to the numbers given. Never invent numbers that are not in the data.'

/** Read a scorecard photo into per-hole par, handicap and yardage. The player reviews the result before saving. */
export async function readScorecardPhoto(env: AiEnv, jpeg: ArrayBuffer, tee: string): Promise<{ rows: { hole: number; par?: number; hcp?: number; yds?: number }[] }> {
  const text = await claude(env, 'routine', 'scorecard photo', 'You read golf scorecards. Reply with JSON only.', [
    imageBlock(jpeg),
    { type: 'text', text: `This is a golf scorecard photo. Extract the rows for the ${tee ? `"${tee}" tees` : 'tees shown'}. Reply with JSON only, no prose: {"rows":[{"hole":1,"par":4,"hcp":7,"yds":372}, ...]}. Use hole numbers 1 to 18 (or 1 to 9). Leave out any value you cannot read clearly instead of guessing. Skip total and in/out columns.` },
  ], 1200)
  const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
  let parsed: { rows?: { hole?: number; par?: number; hcp?: number; yds?: number }[] }
  try { parsed = JSON.parse(json) } catch { throw new CoachBlocked("Couldn't make sense of that photo. Try a flatter, closer shot.") }
  const rows = (parsed.rows ?? []).flatMap((r) => {
    const hole = Number(r.hole)
    if (!Number.isInteger(hole) || hole < 1 || hole > 18) return []
    const par = Number(r.par), hcp = Number(r.hcp), yds = Number(r.yds)
    return [{ hole, ...(par >= 3 && par <= 6 ? { par } : {}), ...(hcp >= 1 && hcp <= 18 ? { hcp } : {}), ...(yds >= 60 && yds <= 800 ? { yds } : {}) }]
  })
  if (!rows.length) throw new CoachBlocked("Couldn't find hole rows in that photo.")
  return { rows }
}

/** After-round write-up from the round's own numbers (Haiku). */
export const roundWriteup = (env: AiEnv, facts: string, profile?: Profile | null) =>
  claude(env, 'routine', 'round write-up', `You write a short after-round summary for the golfer. ${STYLE} Cover where strokes were lost, where they were gained, and one thing to do next round. 120 words at most. No headings. No bullet symbols.`,
    [{ type: 'text', text: `${profilePrompt(profile)}\n\nRound facts:\n${facts.slice(0, 4000)}` }], 500)

/** Suggestions from scores and strokes lost across recent rounds. Haiku by default, Sonnet when the player asks to go deeper. */
export const suggestions = (env: AiEnv, facts: string, profile: Profile | null | undefined, deep: boolean) =>
  claude(env, deep ? 'deep' : 'routine', deep ? 'deeper review' : 'suggestions', `You are a practical golf coach reading scorecard stats. ${STYLE} Give ${deep ? 'up to 5' : '3'} numbered suggestions, ordered by strokes they could save. Each is one or two sentences and names a drill or a course-management habit. ${deep ? 'End with a short practice plan for the next two weeks.' : ''}`,
    [{ type: 'text', text: `${profilePrompt(profile)}\n\nStats:\n${facts.slice(0, 6000)}` }], deep ? 1500 : 600)

/** Feedback on one swing from its key frames and pose-tracked numbers. Always framed as an estimate. */
export async function swingFeedback(env: AiEnv, input: { swing: Swing; frames: { phase: string; jpeg: ArrayBuffer }[]; profile?: Profile | null }): Promise<string> {
  const { swing, frames, profile } = input
  const m = swing.metrics
  const nums = m ? JSON.stringify({ view: swing.view, tempoRatio: m.tempoRatio, spineChangeDeg: m.spineChangeDeg, earlyExtensionPct: m.earlyExtensionPct, leadArmDegAtTop: m.leadArmDeg, handsAtTopPct: m.handsAtTopPct, headToTop: m.headToTop, headToImpact: m.headToImpact }) : 'none'
  const content: unknown[] = []
  for (const f of frames.slice(0, 6)) { content.push({ type: 'text', text: `Frame: ${f.phase}` }); content.push(imageBlock(f.jpeg)) }
  content.push({ type: 'text', text: `${profilePrompt(profile)}\n\nClub: ${swing.club ?? 'unknown'}. Camera: ${swing.view === 'face_on' ? 'face on' : 'from behind'}.\nPose-tracked numbers (estimates from a phone camera, can be off): ${nums}\n\nGive feedback on this swing.` })
  const text = await claude(env, 'routine', 'swing feedback', `You are a golf swing coach looking at key frames of one swing. ${STYLE} Give 3 short points: the main thing to fix, why it matters for ball flight, and one drill. Be honest about what a phone camera cannot show. If the frames or numbers do not support a point, leave it out. 110 words at most. No headings.`, content, 450)
  return `Estimate from phone video and pose tracking.\n\n${text}`
}
