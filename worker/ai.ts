import type { Swing } from '../shared/types'

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

export interface ClipInput { swing: Swing; frames: { phase: string; jpeg: ArrayBuffer }[] }
export interface WeeklyInput { swings: Swing[]; rounds: unknown[]; weekOf: string }
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
