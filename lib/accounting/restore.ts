// lib/accounting/restore.ts
// Git Model - restore a branch to a previous point (creates rollback event + updates head)
// The rollback event's parent is set to the *target* so that the visible ancestry jumps back.
// See docs/Git-Model-*.md

import { prisma } from '@/lib/prisma'
import { getBranch, setBranchHead } from './branch'

export async function restoreBranchToEvent(branchName: string, targetEventId: string): Promise<{ rollbackEventId: string }> {
  const branch = await getBranch(branchName)
  if (!branch) throw new Error('Branch not found')

  const targetEvent = await prisma.event.findUnique({ where: { id: targetEventId } })
  if (!targetEvent) throw new Error('Target event not found')

  // Create a rollback audit event whose parent points at the target.
  // This makes all *subsequent* bad events no longer in the ancestor chain of the new head.
  const rollbackEvent = await prisma.event.create({
    data: {
      eventType: 'ROLLBACK',
      entityType: 'AccountingBranch',
      entityId: branch.id,
      parentEventId: targetEventId,   // <--- critical: ancestry now follows the target, not the previous head
      payload: {
        branch: branchName,
        fromHead: branch.headEventId,
        toEventId: targetEventId,
        reason: 'user or AI requested restore',
      },
      createdBy: null,
    },
  })

  // Move the branch head to the rollback event (which itself parents to the target).
  await setBranchHead(branchName, rollbackEvent.id)

  return { rollbackEventId: rollbackEvent.id }
}
