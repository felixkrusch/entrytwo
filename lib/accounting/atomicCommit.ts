import { Prisma, type EventType } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getCompanyProfile } from '@/lib/companyProfile'
import { calculateFxBalance } from './fxBalance'
import { assertAccountingPeriodOpen } from './periods'

export type AtomicJournalLine = {
  accountId: string
  debit: number
  credit: number
  description?: string | null
  taxRateId?: string | null
  taxIsInput?: boolean | null
  currency?: string | null
  fxRateToBase?: number | null
  fxSource?: string | null
  fxDate?: string | Date | null
  contactId?: string | null
  cleared?: boolean
}

export type AtomicJournalAttachment = {
  id: string
  source?: string
}

export type AtomicJournalCommitInput = {
  date: string | Date
  description?: string | null
  branch?: string
  baseCurrency?: string
  createdBy?: string | null
  eventType?: EventType
  eventPayload?: Record<string, unknown>
  idempotencyKey?: string
  attachments?: AtomicJournalAttachment[]
  lines: AtomicJournalLine[]
}

const journalInclude = {
  lines: {
    include: {
      account: { select: { code: true, name: true } },
      taxRate: { select: { id: true, jurisdiction: true, name: true, rate: true, taxType: true } },
      contact: { select: { id: true, name: true, type: true } },
    },
  },
  attachments: true,
} satisfies Prisma.JournalEntryInclude

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

async function nextEntryNumber(tx: Prisma.TransactionClient, date: Date) {
  const year = date.getUTCFullYear()
  const prefix = `JE-${year}-`
  await tx.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_advisory_xact_lock(hashtext(${`journal-entry-number:${year}`})) IS NULL AS locked`
  const latest = await tx.journalEntry.findFirst({
    where: { entryNumber: { startsWith: prefix } },
    orderBy: { entryNumber: 'desc' },
    select: { entryNumber: true },
  })
  const parsed = latest?.entryNumber ? Number(latest.entryNumber.slice(prefix.length)) : 0
  return `${prefix}${String((Number.isFinite(parsed) ? parsed : 0) + 1).padStart(4, '0')}`
}

export async function commitJournalInTransaction(tx: Prisma.TransactionClient, input: AtomicJournalCommitInput) {
  if (input.lines.length < 2) throw new Error('A journal entry requires at least two lines')
  if (!input.baseCurrency) throw new Error('baseCurrency is required inside an existing transaction')
  const baseCurrency = input.baseCurrency.toUpperCase()
  const balance = calculateFxBalance(input.lines, baseCurrency)
  if (!balance.balanced) {
    const missing = balance.missingRates.length ? ` Missing FX rates: ${balance.missingRates.join(', ')}.` : ''
    throw new Error(`Debits must equal credits in ${baseCurrency} and be greater than zero.${missing}`)
  }

  const date = new Date(input.date)
  if (Number.isNaN(date.getTime())) throw new Error('Invalid journal date')
  date.setUTCHours(0, 0, 0, 0)
  await assertAccountingPeriodOpen(tx, date)
  const branchName = input.branch || 'main'
  const idempotencyKey = input.idempotencyKey?.trim() || null

  await tx.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_advisory_xact_lock(hashtext(${`accounting-branch:${branchName}`})) IS NULL AS locked`

    if (idempotencyKey) {
      const existingEvent = await tx.event.findUnique({ where: { idempotencyKey }, select: { entityType: true, entityId: true } })
      if (existingEvent) {
        if (existingEvent.entityType !== 'JournalEntry') throw new Error('Idempotency key is already used by another operation')
        return tx.journalEntry.findUniqueOrThrow({ where: { id: existingEvent.entityId }, include: journalInclude })
      }
    }

    let branch = await tx.accountingBranch.findUnique({ where: { name: branchName } })
    if (!branch && branchName === 'main') {
      branch = await tx.accountingBranch.create({ data: { name: 'main', description: 'Main accounting branch', isMain: true, createdBy: input.createdBy || null } })
    }
    if (!branch) throw new Error(`Accounting branch "${branchName}" not found`)

    const entryNumber = await nextEntryNumber(tx, date)
    const attachments = input.attachments || []
    const entry = await tx.journalEntry.create({
      data: {
        date,
        description: input.description || null,
        entryNumber,
        createdBy: input.createdBy || null,
        attachments: attachments.length ? {
          create: attachments.map(attachment => ({ fileAssetId: attachment.id, source: attachment.source || 'journal-commit', createdBy: input.createdBy || null })),
        } : undefined,
        lines: {
          create: input.lines.map(line => ({
            accountId: line.accountId,
            debit: line.debit,
            credit: line.credit,
            description: line.description || null,
            taxRateId: line.taxRateId || null,
            taxIsInput: typeof line.taxIsInput === 'boolean' ? line.taxIsInput : null,
            currency: (line.currency || baseCurrency).toUpperCase(),
            fxRateToBase: line.fxRateToBase ?? null,
            fxSource: line.fxSource || null,
            fxDate: line.fxDate ? new Date(line.fxDate) : null,
            contactId: line.contactId || null,
            cleared: line.cleared || false,
          })),
        },
      },
      include: journalInclude,
    })

    const event = await tx.event.create({
      data: {
        eventType: input.eventType || 'JOURNAL_ENTRY_CREATED',
        entityType: 'JournalEntry',
        entityId: entry.id,
        idempotencyKey,
        parentEventId: branch.headEventId,
        createdBy: input.createdBy || null,
        payload: jsonValue({
          description: entry.description,
          date: entry.date,
          lines: entry.lines.map(line => ({
            account: line.account.code,
            debit: Number(line.debit),
            credit: Number(line.credit),
            currency: line.currency,
            fxRateToBase: line.fxRateToBase == null ? null : Number(line.fxRateToBase),
            fxSource: line.fxSource,
          })),
          attachments: entry.attachments.map(attachment => ({ id: attachment.id, fileAssetId: attachment.fileAssetId })),
          ...input.eventPayload,
        }),
      },
    })

    await tx.journalEntry.update({ where: { id: entry.id }, data: { introducedByEventId: event.id } })
    const advanced = await tx.accountingBranch.updateMany({
      where: { id: branch.id, headEventId: branch.headEventId },
      data: { headEventId: event.id },
    })
    if (advanced.count !== 1) throw new Error('Accounting branch head changed during commit')

  return { ...entry, introducedByEventId: event.id }
}

export async function commitJournalAtomic(input: AtomicJournalCommitInput) {
  const baseCurrency = (input.baseCurrency || (await getCompanyProfile()).baseCurrency).toUpperCase()
  return prisma.$transaction(
    tx => commitJournalInTransaction(tx, { ...input, baseCurrency }),
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10_000, timeout: 30_000 },
  )
}
