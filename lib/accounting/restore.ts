// lib/accounting/restore.ts
// Git Model - restore a branch to a previous point (creates rollback event + updates head)
// The rollback event's parent is set to the *target* so that the visible ancestry jumps back.
// See docs/Git-Model-*.md

import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'

export async function restoreBranchToEvent(branchName: string, targetEventId: string, createdBy?: string | null): Promise<{ rollbackEventId: string }> {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_advisory_xact_lock(hashtext(${`accounting-branch:${branchName}`})) IS NULL AS locked`
    const branch = await tx.accountingBranch.findUnique({ where: { name: branchName } })
    if (!branch) throw new Error('Branch not found')
    const targetEvent = await tx.event.findUnique({ where: { id: targetEventId }, select: { id: true } })
    if (!targetEvent) throw new Error('Target event not found')

    const rollbackEvent = await tx.event.create({
      data: {
        eventType: 'ROLLBACK', entityType: 'AccountingBranch', entityId: branch.id,
        parentEventId: targetEventId,
        payload: { branch: branchName, fromHead: branch.headEventId, toEventId: targetEventId, reason: 'user or AI requested restore' },
        createdBy: createdBy || null,
      },
    })
    const advanced = await tx.accountingBranch.updateMany({ where: { id: branch.id, headEventId: branch.headEventId }, data: { headEventId: rollbackEvent.id } })
    if (advanced.count !== 1) throw new Error('Accounting branch head changed during restore')
    return { rollbackEventId: rollbackEvent.id }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10_000, timeout: 30_000 })
}
