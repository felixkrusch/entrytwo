import { ChatIntent } from './intent'

export type ChatMode = 'EXECUTION' | 'ADVISORY'

/**
 * Decides whether the current user turn should be handled as
 * an executable action (two-pass + validation + dispatcher)
 * or as advisory / explanatory / reasoning.
 *
 * Current implementation (Phase 2):
 * - If two-pass produced a valid, non-proposal action result → EXECUTION
 * - Otherwise → ADVISORY
 *
 * This decision will be made earlier and cheaper in the future
 * (lightweight classifier or adjusted Pass 1 that can return "no action").
 *
 * Keeping it explicit here makes the dual-path architecture obvious
 * and easy to evolve without technical debt.
 */
export function decideChatMode(params: {
  twoPassProducedResult: boolean
  proposedAction?: any
  executed?: boolean
}): ChatMode {
  if (params.twoPassProducedResult && !params.proposedAction) {
    return 'EXECUTION'
  }
  return 'ADVISORY'
}

/**
 * Helper to decide from a dispatch result (used after two-pass).
 */
export function decideModeFromDispatchResult(result: any): ChatMode {
  if (result && result.action && !result.proposed && !result.proposedAction) {
    return 'EXECUTION'
  }
  return 'ADVISORY'
}
