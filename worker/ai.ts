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
