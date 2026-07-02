// lib/accounting/merge.ts
// Git Model - merge one branch into another (creates new events for the net effect)
// Very simplified first version: re-apply the net delta as new journal entries on target.
// See docs/Git-Model-*.md

import { prisma } from '@/lib/prisma'
import { getBranch, setBranchHead } from './branch'

export async function mergeBranch(sourceName: string, targetName: string = 'main'): Promise<{ mergedEventIds: string[] }> {
  const source = await getBranch(sourceName)
  const target = await getBranch(targetName)

  if (!source || !target) throw new Error('Branch not found')
  if (!source.headEventId) return { mergedEventIds: [] }

  // For a real impl we would compute the actual diff of journal lines.
  // For foundation: we simply create a "merge" event and update the target head.
  // In a fuller version we would create reversing + new entries to represent the merge.

  const mergeEvent = await prisma.event.create({
    data: {
      eventType: 'MERGE',
      entityType: 'AccountingBranch',
      entityId: target.id,
      parentEventId: target.headEventId || null, // continue from target's current head
      payload: {
        source: sourceName,
        target: targetName,
        sourceHead: source.headEventId,
        targetHeadBefore: target.headEventId,
      },
      createdBy: null,
    },
  })

  // Advance target head to the merge event
  await setBranchHead(targetName, mergeEvent.id)

  return { mergedEventIds: [mergeEvent.id] }
}
