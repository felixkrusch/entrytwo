import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { commitJournalAtomic } from '@/lib/accounting/atomicCommit'

/**
 * Normalized processor transaction (used by both Stripe and PayPal paths).
 * All amounts are in the currency of the transaction (not yet converted to base).
 */
export interface NormalizedProcessorTx {
  externalId: string
  date: Date
  description: string
  merchant?: string | null
  amount: number
  currency: string
  feeAmount?: number
  feeCurrency?: string
  netAmount?: number
  netCurrency?: string
  exchangeRateToBase?: number | null
  fxSource?: string | null
  fxDate?: string | null
  type: 'charge' | 'refund' | 'payout' | 'fee' | 'dispute' | 'adjustment' | 'payment'
  direction: 'in' | 'out'
  payoutId?: string | null
  raw: Record<string, unknown>
}

/**
 * Create a FeedTransaction from a normalized processor tx.
 * Idempotent via connectionId + externalId.
 */
export async function upsertFeedTransaction(
  connectionId: string,
  tx: NormalizedProcessorTx
): Promise<{ created: boolean; id: string }> {
  const exists = await prisma.feedTransaction.findUnique({
    where: { connectionId_externalId: { connectionId, externalId: tx.externalId } },
  })
  if (exists) {
    return { created: false, id: exists.id }
  }

  const created = await prisma.feedTransaction.create({
    data: {
      connectionId,
      externalId: tx.externalId,
      date: tx.date,
      description: tx.description,
      merchant: tx.merchant || null,
      amount: tx.amount,
      currency: tx.currency,
      fxRateToBase: tx.exchangeRateToBase ?? null,
      status: 'pending',
      rawData: tx.raw as unknown as Prisma.InputJsonValue,
    },
  })
  return { created: true, id: created.id }
}

/**
 * Create a proper Git-model journal entry from a normalized processor transaction.
 * This is the single source of truth for "good" processor journal entries.
 */
export async function createProcessorJournalEntry(
  tx: NormalizedProcessorTx,
  opts: {
    connectionId: string
    settlementAccountCode: string // e.g. "1010" or "1000" (bank) or a "Stripe Clearing" account
    feeAccountCode?: string // e.g. "5200" or dedicated fees account
    counterAccountCode?: string // fallback revenue/expense
    branch?: string
  }
) {
  const branch = opts.branch || 'main'
  const settlement = await prisma.account.findFirst({
    where: { OR: [{ code: opts.settlementAccountCode }, { name: { contains: opts.settlementAccountCode, mode: 'insensitive' } }] },
  })
  if (!settlement) throw new Error(`Settlement account ${opts.settlementAccountCode} not found`)

  let feeAccount = null
  if (opts.feeAccountCode) {
    feeAccount = await prisma.account.findFirst({
      where: { OR: [{ code: opts.feeAccountCode }, { name: { contains: opts.feeAccountCode, mode: 'insensitive' } }] },
    })
  }

  const lines: Array<{
    accountId: string
    debit: number
    credit: number
    description?: string
    currency: string
    fxRateToBase?: number | null
    fxSource?: string | null
    fxDate?: Date | null
  }> = []

  const isCredit = tx.direction === 'in' // money into our account

  // Main movement
  if (isCredit) {
    lines.push({
      accountId: settlement.id,
      debit: tx.netAmount ?? tx.amount,
      credit: 0,
      description: tx.description,
      currency: tx.currency,
      fxRateToBase: tx.exchangeRateToBase ?? null,
      fxSource: tx.fxSource || `BANK_FEED:stripe:${tx.externalId}`,
      fxDate: tx.fxDate ? new Date(tx.fxDate) : tx.date,
    })
  } else {
    lines.push({
      accountId: settlement.id,
      debit: 0,
      credit: tx.netAmount ?? tx.amount,
      description: tx.description,
      currency: tx.currency,
      fxRateToBase: tx.exchangeRateToBase ?? null,
      fxSource: tx.fxSource || `BANK_FEED:stripe:${tx.externalId}`,
      fxDate: tx.fxDate ? new Date(tx.fxDate) : tx.date,
    })
  }

  // Fees (explicit)
  if (tx.feeAmount && tx.feeAmount > 0 && feeAccount) {
    if (isCredit) {
      // fee reduces what we received
      lines.push({
        accountId: feeAccount.id,
        debit: tx.feeAmount,
        credit: 0,
        description: 'Processor fee',
        currency: tx.feeCurrency || tx.currency,
      })
    } else {
      lines.push({
        accountId: feeAccount.id,
        debit: 0,
        credit: tx.feeAmount,
        description: 'Processor fee',
        currency: tx.feeCurrency || tx.currency,
      })
    }
  }

  // If we still need balancing, create a counter line (revenue/expense placeholder)
  const totalDebit = lines.reduce((s, l) => s + (l.debit || 0), 0)
  const totalCredit = lines.reduce((s, l) => s + (l.credit || 0), 0)
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    const diff = Math.abs(totalDebit - totalCredit)
    if (opts.counterAccountCode) {
      const counter = await prisma.account.findFirst({
        where: { OR: [{ code: opts.counterAccountCode }, { name: { contains: opts.counterAccountCode, mode: 'insensitive' } }] },
      })
      if (counter) {
        if (totalDebit > totalCredit) {
          lines.push({ accountId: counter.id, debit: 0, credit: diff, description: 'Counter', currency: tx.currency })
        } else {
          lines.push({ accountId: counter.id, debit: diff, credit: 0, description: 'Counter', currency: tx.currency })
        }
      }
    }
  }

  const businessDate = new Date(tx.date)
  businessDate.setUTCHours(0, 0, 0, 0)

  return commitJournalAtomic({
    date: businessDate,
    description: tx.description || `Processor ${tx.type}`,
    branch,
    idempotencyKey: `processor:${opts.connectionId}:${tx.externalId}`,
    eventPayload: { source: 'processor', connectionId: opts.connectionId, externalId: tx.externalId, processorType: tx.type },
    lines: lines.map(line => ({
      ...line,
      debit: line.debit || 0,
      credit: line.credit || 0,
      fxRateToBase: line.fxRateToBase ?? tx.exchangeRateToBase ?? null,
      fxSource: line.fxSource || tx.fxSource || `BANK_FEED:processor:${tx.externalId}`,
      fxDate: line.fxDate ?? (tx.fxDate ? new Date(tx.fxDate) : tx.date),
      cleared: false,
    })),
  })
}
