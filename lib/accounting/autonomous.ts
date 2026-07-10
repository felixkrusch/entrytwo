// lib/accounting/autonomous.ts
// Git Model: helper to create journal entries autonomously at high confidence
// Uses ancestry: parent to current head of target branch, advance head.

import { prisma } from '@/lib/prisma'
import { recordCommitOnBranch } from './commit'
import { nextEntryNumber } from './entryNumber'
import { isAuthoritativeBankFeed, normalizeToProvisional } from '@/lib/fxSources'
import type { StoredAttachment } from '@/lib/attachments'

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
  attachments?: StoredAttachment[]
  createdBy?: string | null       // attributing user (null for system/AI)
}

export async function createAutonomousJournal(input: AutonomousJournalInput) {
  const targetBranch = input.branch || 'main'

  const br = await prisma.accountingBranch.findUnique({ where: { name: targetBranch } })
  const parentHead = br?.headEventId || null

  const entryNumber = await nextEntryNumber(new Date(input.date))

  // Business date = calendar day only (midnight UTC). Real creation time lives in createdAt.
  const businessDate = new Date(input.date)
  businessDate.setUTCHours(0, 0, 0, 0)

  const attachments = input.attachments || []
  const entry = await prisma.journalEntry.create({
    data: {
      date: businessDate,
      description: input.description,
      entryNumber,
      createdBy: input.createdBy ?? null,
      sourcePdfPath: attachments[0]?.path || input.sourcePdfPath || null,
      attachments: attachments.length ? {
        create: attachments.map(attachment => ({ ...attachment, source: 'chat', createdBy: input.createdBy ?? null })),
      } : undefined,
      lines: {
        create: input.lines.map(l => {
          const cur = (l.currency || 'EUR').toUpperCase()
          let fxSource = l.fxSource || null
          if (cur !== 'EUR' && !isAuthoritativeBankFeed(fxSource)) {
            fxSource = normalizeToProvisional(fxSource)
          } else if (!fxSource && l.fxRateToBase != null) {
            fxSource = 'AI_AUTONOMOUS'
          }
          return {
            accountId: l.accountId,
            debit: l.debit,
            credit: l.credit,
            description: l.description,
            currency: cur,
            fxRateToBase: l.fxRateToBase ?? null,
            fxSource,
            fxDate: l.fxDate ? new Date(l.fxDate) : null,
            taxRateId: l.taxRateId || null,
            taxIsInput: typeof l.taxIsInput === 'boolean' ? l.taxIsInput : null,
            contactId: l.contactId || null,
            cleared: false,
          }
        }),
      },
    },
    include: {
      lines: { include: { account: { select: { code: true, name: true } } } },
      attachments: true,
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
        attachments: entry.attachments.map(attachment => ({ id: attachment.id, path: attachment.path, sha256: attachment.sha256 })),
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
