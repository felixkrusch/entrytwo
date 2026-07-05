export type ChatMode = 'advisor' | 'execution'

export const DEFAULT_CHAT_MODE: ChatMode = 'execution'

export function isAdvisorMode(mode: string | null | undefined): boolean {
  return mode === 'advisor'
}

export function isExecutionMode(mode: string | null | undefined): boolean {
  return mode === 'execution' || !mode
}
