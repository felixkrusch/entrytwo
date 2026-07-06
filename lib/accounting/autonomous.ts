// lib/accounting/autonomous.ts
// Git Model: helper to create journal entries autonomously at high confidence
// Uses ancestry: parent to current head of target branch, advance head.

import { prisma } from '@/lib/prisma'
import { recordCommitOnBranch } from './commit'
import { nextEntryNumber } from './entryNumber'

export interface AutonomousJournalInput {
  date: string
  description: string
  lines: Array<{
    accountId: string
    debit: number
    credit: number
    description?: string
    currency?: string
    fxRateToBase?: number | null
    fxSource?: string | null
    fxDate?: string | null
    taxRateId?: string | null
    taxIsInput?: boolean | null
    contactId?: string | null
  }>
  aiMetadata?: {
    confidence?: number
    model?: string
    reasoning?: string
  }
  branch?: string
  sourcePdfPath?: string | null   // link to uploaded invoice/receipt under /uploads/receipts
  createdBy?: string | null       // attributing user (null for system/AI)
}

export async function createAutonomousJournal(input: AutonomousJournalInput) {
  const targetBranch = input.branch || 'main'

  const br = await prisma.accountingBranch.findUnique({ where: { name: targetBranch } })
  const parentHead = br?.headEventId || null

  const entryNumber = await nextEntryNumber(new Date(input.date))

  const entry = await prisma.journalEntry.create({
    data: {
      date: new Date(input.date),
      description: input.description,
      entryNumber,
      createdBy: input.createdBy ?? null,
      sourcePdfPath: input.sourcePdfPath || null,
      lines: {
        create: input.lines.map(l => ({
          accountId: l.accountId,
          debit: l.debit,
          credit: l.credit,
          description: l.description,
          currency: l.currency || 'EUR',
          fxRateToBase: l.fxRateToBase ?? null,
          fxSource: l.fxSource || (l.fxRateToBase != null ? 'AI_AUTONOMOUS' : null),
          fxDate: l.fxDate ? new Date(l.fxDate) : null,
          taxRateId: l.taxRateId || null,
          taxIsInput: typeof l.taxIsInput === 'boolean' ? l.taxIsInput : null,
          contactId: l.contactId || null,
          cleared: false,
        })),
      },
    },
    include: {
      lines: { include: { account: { select: { code: true, name: true } } } },
    },
  })

  // Create the autonomous event parented to current head
  const ev = await prisma.event.create({
    data: {
      eventType: 'AI_AUTONOMOUS_ENTRY',
      entityType: 'JournalEntry',
      entityId: entry.id,
      parentEventId: parentHead,
      payload: {
        description: entry.description,
        lines: entry.lines.map(l => ({
          account: l.account.code,
          debit: Number(l.debit),
          credit: Number(l.credit),
        })),
        ai: input.aiMetadata || {},
      },
      createdBy: null,
    },
  })

  // Mark entry as introduced by this event
  await prisma.journalEntry.update({
    where: { id: entry.id },
    data: { introducedByEventId: ev.id }
  })

  // Advance the branch head
  await recordCommitOnBranch(entry.id, targetBranch, ev.id)

  return entry
}
