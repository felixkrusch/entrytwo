// lib/accounting/reverse.ts
// Minimal helper for reversing a journal entry (used by autonomous path).
// Creates a new entry with debits/credits swapped and records Git ancestry.

import { prisma } from '@/lib/prisma'
import { recordCommitOnBranch } from './commit'
import { EventType } from '@prisma/client'

export async function reverseJournalEntry(originalId: string, branch = 'main') {
  const original = await prisma.journalEntry.findUnique({
    where: { id: originalId },
    include: { lines: true },
  })
  if (!original) throw new Error('Original entry not found')

  const revLines = original.lines.map(l => ({
    accountId: l.accountId,
    debit: Number(l.credit),
    credit: Number(l.debit),
    description: `Reversal of ${originalId}`,
    currency: l.currency || 'EUR',
    fxRateToBase: l.fxRateToBase,
    fxSource: l.fxSource,
    fxDate: l.fxDate,
    taxRateId: l.taxRateId,
    taxIsInput: l.taxIsInput,
    contactId: l.contactId,
  }))

  // Business date = today at midnight UTC (calendar day semantics).
  // Real creation time is in createdAt.
  const businessDate = new Date()
  businessDate.setUTCHours(0, 0, 0, 0)

  const revEntry = await prisma.journalEntry.create({
    data: {
      date: businessDate,
      description: `Reversal of ${original.description || originalId}`,
      lines: { create: revLines },
    },
  })

  const ev = await prisma.event.create({
    data: {
      eventType: EventType.JOURNAL_ENTRY_REVERSED,
      entityType: 'JournalEntry',
      entityId: revEntry.id,
      payload: { originalId, originalEntryId: originalId },
      createdBy: null,
    },
  })

  await recordCommitOnBranch(revEntry.id, branch, ev.id)

  return revEntry
}
