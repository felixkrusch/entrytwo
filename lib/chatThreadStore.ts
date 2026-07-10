// lib/chatThreadStore.ts
// Simple in-memory thread store for conversation context.
// In production this would be backed by a DB (e.g. prisma model for ChatThread + ChatMessage).
// For now this gives proper server-side context management without the client
// having to resend the entire growing history on every request.

export type ChatTurn = {
  role: 'user' | 'assistant'
  content: string
}

type Thread = {
  id: string
  messages: ChatTurn[]
  createdAt: number
  updatedAt: number
}

const threads = new Map<string, Thread>()

export function createThread(): string {
  const id = `th_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
  const thread: Thread = {
    id,
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  threads.set(id, thread)
  return id
}

export function getThread(id: string): Thread | null {
  return threads.get(id) || null
}

export function appendToThread(id: string, turn: ChatTurn): Thread | null {
  const t = threads.get(id)
  if (!t) return null
  t.messages.push(turn)
  t.updatedAt = Date.now()
  return t
}

export function loadOrCreateThread(id?: string): { thread: Thread; isNew: boolean } {
  if (id) {
    const existing = threads.get(id)
    if (existing) {
      return { thread: existing, isNew: false }
    }
  }
  const newId = createThread()
  const thread = threads.get(newId)!
  return { thread, isNew: true }
}

// Keep a generous bounded window. Document extraction turns are intentionally retained
// verbatim by the chat route so statement details survive follow-up discussion.
export function getContextForModel(thread: Thread, maxTurns = 80): ChatTurn[] {
  if (thread.messages.length <= maxTurns) return thread.messages
  // Keep the most recent turns
  return thread.messages.slice(-maxTurns)
}
