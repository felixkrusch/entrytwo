import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getCompanyProfile } from '@/lib/companyProfile'
import { calculateFxBalance } from './fxBalance'

/**
 * Finalizes a journal/event pair created by a legacy posting path. New code should
 * use commitJournalAtomic so creation and finalization share the same transaction.
 */
export async function recordCommitOnBranch(
  journalEntryId?: string,
  branchName = 'main',
  eventIdForParenting?: string,
) {
  if (!journalEntryId) throw new Error('journalEntryId is required to finalize an accounting commit')
  const baseCurrency = (await getCompanyProfile()).baseCurrency.toUpperCase()

  return prisma.$transaction(async tx => {
    await tx.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_advisory_xact_lock(hashtext(${`accounting-branch:${branchName}`})) IS NULL AS locked`
    let branch = await tx.accountingBranch.findUnique({ where: { name: branchName } })
    if (!branch && branchName === 'main') {
      branch = await tx.accountingBranch.create({ data: { name: 'main', description: 'Main accounting branch', isMain: true } })
    }
    if (!branch) throw new Error(`Accounting branch "${branchName}" not found`)

    const entry = await tx.journalEntry.findUnique({ where: { id: journalEntryId }, include: { lines: true } })
    if (!entry) throw new Error('Journal entry not found')
    const balance = calculateFxBalance(entry.lines.map(line => ({
      debit: line.debit.toString(),
      credit: line.credit.toString(),
      currency: line.currency,
      fxRateToBase: line.fxRateToBase?.toString(),
    })), baseCurrency)
    if (!balance.balanced) throw new Error(`Cannot commit an unbalanced journal entry in ${baseCurrency}`)

    let eventId = eventIdForParenting || entry.introducedByEventId
    if (!eventId) {
      const event = await tx.event.create({
        data: {
          eventType: 'JOURNAL_ENTRY_CREATED', entityType: 'JournalEntry', entityId: entry.id,
          parentEventId: branch.headEventId,
          payload: { description: entry.description, legacyFinalization: true },
          createdBy: entry.createdBy,
        },
      })
      eventId = event.id
    } else {
      const event = await tx.event.findUnique({ where: { id: eventId }, select: { entityType: true, entityId: true } })
      if (!event || event.entityType !== 'JournalEntry' || event.entityId !== entry.id) throw new Error('Commit event does not belong to the journal entry')
      if (entry.introducedByEventId === eventId && branch.headEventId === eventId) return { journalEntryId: entry.id, eventId }
      await tx.event.update({ where: { id: eventId }, data: { parentEventId: branch.headEventId } })
    }

    await tx.journalEntry.update({ where: { id: entry.id }, data: { introducedByEventId: eventId } })
    const advanced = await tx.accountingBranch.updateMany({ where: { id: branch.id, headEventId: branch.headEventId }, data: { headEventId: eventId } })
    if (advanced.count !== 1) throw new Error('Accounting branch head changed during commit')
    return { journalEntryId: entry.id, eventId }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10_000, timeout: 30_000 })
}

export async function recordCommitOnMain(journalEntryId?: string) {
  return recordCommitOnBranch(journalEntryId, 'main')
}
