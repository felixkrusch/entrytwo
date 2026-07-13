// lib/accounting/merge.ts
// Git Model - merge one branch into another.
//
// A merge integrates the *branch-only* journal entries (those visible on the source
// but not on the target) into the target branch by replaying them as new double-entry
// commits parented onto the target head. This makes the merged entries part of the
// target's ancestry, so `getVisibleJournalEntryIds` (and therefore the Balance Sheet,
// P&L, and journal feed) actually reflects them. A pure stub that only created a MERGE
// event left the source entries invisible on the target — that is what this fixes.
//
// Safety: the source must balance before merging, and the target must still balance
// after the merge (post-merge balance re-check). If either fails the merge is blocked
// (the target head is never advanced), protecting `main` from landing out of balance.

import { prisma } from '@/lib/prisma'
import { getBranch } from './branch'
import { getCompanyProfile } from '@/lib/companyProfile'
import { buildBalanceSheet } from '@/lib/reports'
import { getVisibleJournalEntryIds } from './ancestry'
import { commitJournalInTransaction } from './atomicCommit'
import { Prisma } from '@prisma/client'

export interface MergeResult {
  mergedEventIds: string[]
  balanced: boolean
  blockedReason?: string
}

export async function mergeBranch(sourceName: string, targetName: string = 'main'): Promise<MergeResult> {
  const source = await getBranch(sourceName)
  const target = await getBranch(targetName)

  if (!source || !target) throw new Error('Branch not found')
  if (!source.headEventId) return { mergedEventIds: [], balanced: true }

  const profile = await getCompanyProfile()
  const baseCurrency = profile.baseCurrency || 'EUR'

  // SAFETY GATE 1: never merge a branch whose own books do not balance.
  const srcBs = await buildBalanceSheet({ branch: sourceName, baseCurrency })
  if (!srcBs.balanced) {
    const reason = `Cannot merge "${sourceName}": source branch is out of balance (Assets ${srcBs.assets.total} ≠ Liabilities + Equity ${srcBs.totalEquityWithRetained}). Balance the branch before merging into ${targetName}.`
    const err = new Error(reason) as Error & { status?: number }
    err.status = 422
    throw err
  }

  // Determine which source entries are not already on the target (the diff to merge).
  const sourceVisible = await getVisibleJournalEntryIds(source.headEventId)
  const targetVisible = await getVisibleJournalEntryIds(target.headEventId)
  const toMerge = sourceVisible.filter((id) => !targetVisible.includes(id))

  // Load the entries to merge (with lines) and order them chronologically so the
  // imported commit chain preserves the original posting order.
  const entriesToMerge = await prisma.journalEntry.findMany({
    where: { id: { in: toMerge } },
    include: { lines: true },
    orderBy: { date: 'asc' },
  })

  const mergedEventIds: string[] = []
  await prisma.$transaction(async tx => {
    await tx.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_advisory_xact_lock(hashtext(${`accounting-branch:${targetName}`})) IS NULL AS locked`
    const lockedTarget = await tx.accountingBranch.findUnique({ where: { name: targetName } })
    if (!lockedTarget || lockedTarget.headEventId !== target.headEventId) throw new Error('Target branch changed during merge preparation')

    for (const entry of entriesToMerge) {
      const created = await commitJournalInTransaction(tx, {
        date: entry.date,
        description: entry.description ? `Merge: ${entry.description}` : 'Merged entry',
        branch: targetName,
        baseCurrency,
        idempotencyKey: `merge:${source.headEventId}:${targetName}:${entry.id}`,
        eventPayload: { mergedFrom: sourceName, originalJournalEntryId: entry.id },
        lines: entry.lines.map(line => ({
          accountId: line.accountId,
          debit: Number(line.debit),
          credit: Number(line.credit),
          description: line.description,
          taxRateId: line.taxRateId,
          taxIsInput: line.taxIsInput,
          currency: line.currency,
          fxRateToBase: line.fxRateToBase == null ? null : Number(line.fxRateToBase),
          fxSource: line.fxSource,
          fxDate: line.fxDate,
          contactId: line.contactId,
        })),
      })
      if (created.introducedByEventId) mergedEventIds.push(created.introducedByEventId)
    }

    const currentTarget = await tx.accountingBranch.findUniqueOrThrow({ where: { name: targetName } })
    const markerKey = `merge-marker:${source.headEventId}:${targetName}:${target.headEventId || 'root'}`
    const existingMarker = await tx.event.findUnique({ where: { idempotencyKey: markerKey } })
    const mergeEvent = existingMarker || await tx.event.create({
      data: {
        eventType: 'MERGE', entityType: 'AccountingBranch', entityId: currentTarget.id,
        idempotencyKey: markerKey, parentEventId: currentTarget.headEventId,
        payload: { source: sourceName, target: targetName, sourceHead: source.headEventId, targetHeadBefore: target.headEventId },
        createdBy: null,
      },
    })
    const advanced = await tx.accountingBranch.updateMany({ where: { id: currentTarget.id, headEventId: currentTarget.headEventId }, data: { headEventId: mergeEvent.id } })
    if (advanced.count !== 1) throw new Error('Target branch changed while finalizing merge')
    mergedEventIds.push(mergeEvent.id)
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10_000, timeout: 60_000 })

  const postBs = await buildBalanceSheet({ branch: targetName, baseCurrency })
  if (!postBs.balanced) {
    throw new Error(`Invariant violation: merge of "${sourceName}" into "${targetName}" is out of balance after atomic commit`)
  }

  return { mergedEventIds, balanced: true }
}
