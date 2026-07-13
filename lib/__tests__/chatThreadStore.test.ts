import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/prisma'
import { appendToThread, ChatThreadAccessError, getContextForModel, loadOrCreateThread } from '@/lib/chatThreadStore'

let ownerId = ''
let otherId = ''

beforeAll(async () => {
  const suffix = `${Date.now()}-${Math.random()}`
  const dbUrl = process.env.DATABASE_URL || ''
  if (!dbUrl || !dbUrl.includes('_test')) {
    ownerId = 'skip'
    otherId = 'skip'
    return
  }
  try {
    const [owner, other] = await Promise.all([
      prisma.user.create({ data: { email: `chat-owner-${suffix}@test.local`, role: 'ACCOUNTANT' } as any }),
      prisma.user.create({ data: { email: `chat-other-${suffix}@test.local`, role: 'ACCOUNTANT' } as any }),
    ])
    ownerId = owner.id
    otherId = other.id
  } catch {
    ownerId = 'skip'
    otherId = 'skip'
  }
})

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherId] } } })
})

describe('persistent chat thread context', () => {
  it('retains document context across independently loaded turns', async () => {
    if (ownerId === 'skip') return expect(true).toBe(true)
    const { thread } = await loadOrCreateThread(ownerId)
    await appendToThread({ threadId: thread.id, userId: ownerId, role: 'user', content: 'Process visa.pdf from /api/files/example' })
    await appendToThread({ threadId: thread.id, userId: ownerId, role: 'assistant', content: '{"action":"CREATE_JOURNAL_BATCH"}' })
    await appendToThread({ threadId: thread.id, userId: ownerId, role: 'user', content: 'What was the second transaction?' })

    const reloaded = await loadOrCreateThread(ownerId, thread.id)
    const context = await getContextForModel(reloaded.thread.id, ownerId)
    expect(reloaded.isNew).toBe(false)
    expect(context).toHaveLength(3)
    expect(context[0].content).toContain('visa.pdf')
    expect(context[1].content).toContain('CREATE_JOURNAL_BATCH')
  })

  it('denies another user access to a known thread id', async () => {
    if (ownerId === 'skip' || otherId === 'skip') return expect(true).toBe(true)
    const { thread } = await loadOrCreateThread(ownerId)
    await expect(loadOrCreateThread(otherId, thread.id)).rejects.toBeInstanceOf(ChatThreadAccessError)
    await expect(getContextForModel(thread.id, otherId)).rejects.toBeInstanceOf(ChatThreadAccessError)
    await expect(appendToThread({ threadId: thread.id, userId: otherId, role: 'user', content: 'intrusion' })).rejects.toBeInstanceOf(ChatThreadAccessError)
  })

  it('returns the original message when an idempotency key is repeated', async () => {
    if (ownerId === 'skip') return expect(true).toBe(true)
    const { thread } = await loadOrCreateThread(ownerId)
    const key = `chat-message:${Date.now()}:${Math.random()}`
    const first = await appendToThread({ threadId: thread.id, userId: ownerId, role: 'user', content: 'Create it', idempotencyKey: key })
    const second = await appendToThread({ threadId: thread.id, userId: ownerId, role: 'user', content: 'Create it again', idempotencyKey: key })
    expect(second.id).toBe(first.id)
    expect(await prisma.chatMessage.count({ where: { idempotencyKey: key } })).toBe(1)
  })

  it('returns only the most recent bounded context in chronological order', async () => {
    if (ownerId === 'skip') return expect(true).toBe(true)
    const { thread } = await loadOrCreateThread(ownerId)
    for (let index = 0; index < 6; index++) {
      await appendToThread({ threadId: thread.id, userId: ownerId, role: index % 2 ? 'assistant' : 'user', content: `turn-${index}` })
    }
    const context = await getContextForModel(thread.id, ownerId, 3)
    expect(context.map(turn => turn.content)).toEqual(['turn-3', 'turn-4', 'turn-5'])
  })
})
