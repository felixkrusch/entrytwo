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
  const rawName = (input.name || '').trim()
  if (!rawName) throw new Error('Tag name is required')

  // Human-meaningful names only. Reject auto-generated hash-style names
  // (e.g. "g4-tag-1783411384655") and pure numbers — a tag is an auditor marker
  // for a period-end close / snapshot, so it must be readable and sortable.
  if (/^g\d+-tag(-|$)/i.test(rawName) || /^[\d-]+$/.test(rawName)) {
    throw new Error('Use a human-readable tag name (e.g. FY2026-Q2-close), not an auto-generated id')
  }
  if (rawName.length < 3) {
    throw new Error('Tag name is too short — use something descriptive (e.g. june-close)')
  }

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
        name: rawName,
        branch: branchName,
        eventId: targetEventId,
        description: input.description,
      },
      createdBy: null,
    },
  })

  // Tags are immutable once created: they are append-only audit markers with no
  // update/delete path, so a tagged point can never be silently changed.
  return {
    id: tag.id,
    name: rawName,
    branch: branchName,
    eventId: targetEventId,
    description: input.description,
    createdAt: tag.createdAt,
  }
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
