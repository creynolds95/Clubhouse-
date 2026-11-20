import type { Profile, Swing } from '../shared/types'

/**
 * Coach interface. Off until the final "turn it on" step:
 *   - set AI_ENABLED = "true" in wrangler.jsonc vars
 *   - `wrangler secret put ANTHROPIC_API_KEY`
 *   - implement ClaudeCoach below (Haiku per clip, Sonnet weekly)
 */
export interface AiEnv {
  AI_ENABLED?: string
  AI_PER_CLIP_MODEL?: string
  AI_WEEKLY_MODEL?: string
  ANTHROPIC_API_KEY?: string
}

export interface ClipInput { profile?: Profile; swing: Swing; frames: { phase: string; jpeg: ArrayBuffer }[] }
export interface WeeklyInput { profile?: Profile; swings: Swing[]; rounds: unknown[]; weekOf: string }
export interface Coach {
  clipFeedback(input: ClipInput): Promise<string>
  weeklyReview(input: WeeklyInput): Promise<{ summary: string; plan: unknown }>
}

export const aiStatus = (env: AiEnv) => ({
  enabled: env.AI_ENABLED === 'true' && !!env.ANTHROPIC_API_KEY,
  perClipModel: env.AI_PER_CLIP_MODEL ?? 'claude-haiku-5-5',
  weeklyModel: env.AI_WEEKLY_MODEL ?? 'claude-sonnet-5-5',
})

export class CoachOffError extends Error {
  constructor() { super('The coach is not connected yet') }
}

export function getCoach(env: AiEnv): Coach {
  if (!aiStatus(env).enabled) throw new CoachOffError()
  throw new CoachOffError() // ClaudeCoach lands in the final step.
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
