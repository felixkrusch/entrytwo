import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export type ChatTurn = {
  id: string
  role: 'user' | 'assistant'
  content: string
  action?: string | null
  createdAt: Date
}

export type ChatThreadRecord = {
  id: string
  userId: string
  title: string | null
  createdAt: Date
  updatedAt: Date
  expiresAt: Date | null
  archivedAt: Date | null
}

export class ChatThreadAccessError extends Error {
  constructor() {
    super('Chat thread not found')
    this.name = 'ChatThreadAccessError'
  }
}

export async function loadOrCreateThread(userId: string, id?: string): Promise<{ thread: ChatThreadRecord; isNew: boolean }> {
  if (id) {
    const existing = await prisma.chatThread.findUnique({ where: { id } })
    if (existing) {
      if (existing.userId !== userId || existing.archivedAt) throw new ChatThreadAccessError()
      if (existing.expiresAt && existing.expiresAt <= new Date()) throw new ChatThreadAccessError()
      return { thread: existing, isNew: false }
    }
  }
  const thread = await prisma.chatThread.create({ data: { userId } })
  return { thread, isNew: true }
}

export async function appendToThread(input: {
  threadId: string
  userId: string
  role: 'user' | 'assistant'
  content: string
  action?: string | null
  metadata?: Record<string, unknown>
  idempotencyKey?: string
  fileAssetIds?: string[]
}) {
  const thread = await prisma.chatThread.findFirst({ where: { id: input.threadId, userId: input.userId, archivedAt: null }, select: { id: true, title: true } })
  if (!thread) throw new ChatThreadAccessError()
  const fileAssetIds = [...new Set(input.fileAssetIds || [])]
  if (fileAssetIds.length) {
    const ownedAssets = await prisma.fileAsset.count({ where: { id: { in: fileAssetIds }, createdById: input.userId } })
    if (ownedAssets !== fileAssetIds.length) throw new ChatThreadAccessError()
  }
  const idempotencyKey = input.idempotencyKey?.trim() || null

  return prisma.$transaction(async tx => {
    if (idempotencyKey) {
      const existing = await tx.chatMessage.findUnique({ where: { idempotencyKey } })
      if (existing) {
        if (existing.threadId !== input.threadId) throw new Error('Chat idempotency key belongs to another thread')
        return existing
      }
    }
    const message = await tx.chatMessage.create({
      data: {
        threadId: input.threadId,
        role: input.role,
        content: input.content,
        action: input.action || null,
        metadata: input.metadata ? JSON.parse(JSON.stringify(input.metadata)) as Prisma.InputJsonValue : undefined,
        idempotencyKey,
        attachments: fileAssetIds.length ? { create: fileAssetIds.map(fileAssetId => ({ fileAssetId })) } : undefined,
      },
    })
    await tx.chatThread.update({
      where: { id: input.threadId },
      data: {
        ...(thread.title || input.role !== 'user' ? {} : { title: input.content.replace(/\s+/g, ' ').trim().slice(0, 80) || 'New conversation' }),
        updatedAt: new Date(),
      },
    })
    return message
  })
}

export async function getContextForModel(threadId: string, userId: string, maxTurns = 80): Promise<ChatTurn[]> {
  const thread = await prisma.chatThread.findFirst({ where: { id: threadId, userId, archivedAt: null }, select: { id: true } })
  if (!thread) throw new ChatThreadAccessError()
  const messages = await prisma.chatMessage.findMany({
    where: { threadId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: Math.max(1, Math.min(200, maxTurns)),
    select: { id: true, role: true, content: true, action: true, createdAt: true },
  })
  return messages.reverse().map(message => ({
    id: message.id,
    role: message.role === 'assistant' ? 'assistant' : 'user',
    content: message.content,
    action: message.action,
    createdAt: message.createdAt,
  }))
}

export async function archiveThread(threadId: string, userId: string) {
  const archived = await prisma.chatThread.updateMany({ where: { id: threadId, userId, archivedAt: null }, data: { archivedAt: new Date() } })
  if (archived.count !== 1) throw new ChatThreadAccessError()
}

export async function deleteExpiredThreads(now = new Date()) {
  return prisma.chatThread.deleteMany({ where: { expiresAt: { lte: now } } })
}
