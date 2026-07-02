// lib/accounting/tag.ts
// Git Model - tags for important points (closes, tax filings, auditor snapshots)
// See docs/Git-Model-*.md

import { prisma } from '@/lib/prisma'

export interface CreateTagInput {
  name: string
  branch?: string
  eventId?: string
  description?: string
}

export async function createTag(input: CreateTagInput) {
  const branchName = input.branch || 'main'
  const branch = await prisma.accountingBranch.findUnique({ where: { name: branchName } })
  if (!branch) throw new Error('Branch not found')

  const targetEventId = input.eventId || branch.headEventId
  if (!targetEventId) throw new Error('No target event for tag')

  const tag = await prisma.event.create({
    data: {
      eventType: 'TAG_CREATED',
      entityType: 'AccountingBranch',
      entityId: branch.id,
      payload: {
        name: input.name,
        branch: branchName,
        eventId: targetEventId,
        description: input.description,
      },
      createdBy: null,
    },
  })

  return { id: tag.id, name: input.name, branch: branchName, eventId: targetEventId }
}

export async function listTags(branch?: string) {
  const where: any = { eventType: 'TAG_CREATED' }
  if (branch) {
    where.payload = { path: ['branch'], equals: branch }
  }
  const events = await prisma.event.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  return events.map(e => {
    const p = (e.payload as any) || {}
    return {
      id: e.id,
      name: p.name,
      branch: p.branch || 'main',
      eventId: p.eventId,
      description: p.description,
      createdAt: e.createdAt,
    }
  })
}
