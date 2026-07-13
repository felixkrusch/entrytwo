// lib/accounting/reverse.ts
// Minimal helper for reversing a journal entry (used by autonomous path).
// Creates a new entry with debits/credits swapped and records Git ancestry.

import { prisma } from '@/lib/prisma'
import { EventType } from '@prisma/client'
import { commitJournalAtomic } from './atomicCommit'

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

  return commitJournalAtomic({
    date: new Date(),
    description: `Reversal of ${original.description || originalId}`,
    branch,
    eventType: EventType.JOURNAL_ENTRY_REVERSED,
    idempotencyKey: `journal-reversal:${originalId}:${branch}`,
    eventPayload: { originalId, originalEntryId: originalId },
    lines: revLines.map(line => ({
      ...line,
      fxRateToBase: line.fxRateToBase == null ? null : Number(line.fxRateToBase),
    })),
  })
}
