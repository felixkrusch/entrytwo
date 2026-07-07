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
import { getBranch, setBranchHead } from './branch'
import { getCompanyProfile } from '@/lib/companyProfile'
import { buildBalanceSheet } from '@/lib/reports'
import { getVisibleJournalEntryIds } from './ancestry'
import { nextEntryNumber } from './entryNumber'

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

  let currentHead = target.headEventId || null
  const mergedEventIds: string[] = []

  for (const entry of entriesToMerge) {
    const entryNumber = await nextEntryNumber(entry.date)

    const created = await prisma.journalEntry.create({
      data: {
        date: entry.date,
        description: entry.description ? `Merge: ${entry.description}` : 'Merged entry',
        entryNumber,
        createdBy: null,
        lines: {
          create: entry.lines.map((l) => ({
            accountId: l.accountId,
            debit: Number(l.debit),
            credit: Number(l.credit),
            description: l.description,
            taxRateId: l.taxRateId || null,
            taxIsInput: typeof l.taxIsInput === 'boolean' ? l.taxIsInput : null,
            currency: l.currency || 'EUR',
            fxRateToBase: l.fxRateToBase != null ? Number(l.fxRateToBase) : null,
            fxSource: l.fxSource || null,
            fxDate: l.fxDate || null,
            contactId: l.contactId || null,
            cleared: false,
          })),
        },
      },
    })

    const event = await prisma.event.create({
      data: {
        eventType: 'JOURNAL_ENTRY_CREATED',
        entityType: 'JournalEntry',
        entityId: created.id,
        parentEventId: currentHead,
        payload: {
          description: created.description,
          date: created.date,
          mergedFrom: sourceName,
          lines: entry.lines.map((l) => ({
            account: l.accountId,
            debit: Number(l.debit),
            credit: Number(l.credit),
            currency: l.currency,
          })),
        },
        createdBy: null,
      },
    })

    // Mark the merged entry as introduced by this import event (ancestry visibility).
    await prisma.journalEntry.update({
      where: { id: created.id },
      data: { introducedByEventId: event.id },
    })

    currentHead = event.id
    mergedEventIds.push(event.id)
  }

  // Final merge marker event (so the history shows where the merge landed).
  const mergeEvent = await prisma.event.create({
    data: {
      eventType: 'MERGE',
      entityType: 'AccountingBranch',
      entityId: target.id,
      parentEventId: currentHead,
      payload: {
        source: sourceName,
        target: targetName,
        sourceHead: source.headEventId,
        targetHeadBefore: target.headEventId,
      },
      createdBy: null,
    },
  })
  mergedEventIds.push(mergeEvent.id)

  // SAFETY GATE 2: advance the target head, then re-run the balance check.
  // If the merge somehow left the target out of balance, revert the head and block.
  await setBranchHead(targetName, mergeEvent.id)

  const postBs = await buildBalanceSheet({ branch: targetName, baseCurrency })
  if (!postBs.balanced) {
    await setBranchHead(targetName, target.headEventId || null)
    const reason = `Merge of "${sourceName}" into "${targetName}" produced an out-of-balance state (Assets ${postBs.assets.total} ≠ Liabilities + Equity ${postBs.totalEquityWithRetained}). Merge blocked.`
    const err = new Error(reason) as Error & { status?: number }
    err.status = 422
    throw err
  }

  return { mergedEventIds, balanced: true }
}
