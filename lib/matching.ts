import { prisma } from '@/lib/prisma'
import type { FeedTransaction } from '@prisma/client'
import type { Prisma } from '@prisma/client'

interface MatchResult {
  confidence: number
  journalEntryId?: string
  suggestedEntry?: {
    date: string
    description: string
    lines: Array<{ accountId: string; debit: number; credit: number }>
  }
}

interface FeedTxWithConnection extends FeedTransaction {
  connection: { accountId: string } | null
  lines?: unknown[]
}

interface MerchantPref {
  accountId: string
  taxRateId?: string | null
  [key: string]: unknown
}

// Learn merchant patterns from user corrections
export async function learnMerchant(merchant: string, accountId: string, taxRateId?: string | null) {
  const setting = await prisma.setting.upsert({
    where: { key: `merchant:${merchant.toLowerCase()}` },
    create: {
      key: `merchant:${merchant.toLowerCase()}`,
      value: { accountId, taxRateId } as unknown as Prisma.InputJsonValue,
    },
    update: {
      value: { accountId, taxRateId } as unknown as Prisma.InputJsonValue,
    },
  })
  return setting
}

// Get learned merchant preferences
export async function getMerchantPreference(merchant: string): Promise<MerchantPref | null> {
  if (!merchant) return null

  const setting = await prisma.setting.findUnique({
    where: { key: `merchant:${merchant.toLowerCase()}` },
  })

  return setting?.value as MerchantPref | null
}

export async function findMatch(tx: FeedTxWithConnection): Promise<MatchResult | null> {
  const potentialMatches = await prisma.journalEntry.findMany({
    where: {
      date: {
        gte: new Date(tx.date.getTime() - 86400000),
        lte: new Date(tx.date.getTime() + 86400000),
      },
    },
    include: { lines: { include: { account: true } } },
    take: 20,
  })

  let bestMatch: MatchResult | null = null
  let bestConfidence = 0

  for (const entry of potentialMatches) {
    const confidence = calculateConfidence(tx, entry)
    if (confidence > bestConfidence) {
      bestConfidence = confidence
      bestMatch = { confidence, journalEntryId: entry.id }
    }
  }

  if (!bestMatch || bestConfidence < 50) {
    const suggested = await suggestEntry(tx)
    return { confidence: suggested.confidence, suggestedEntry: suggested.entry }
  }

  return bestMatch
}

function calculateConfidence(tx: FeedTxWithConnection, entry: { date: Date; description: string | null; lines: { debit: unknown; credit: unknown; account: { code: string; name: string } }[] }): number {
  let score = 0
  const txAmount = Number(tx.amount)
  const entryAmount = entry.lines.reduce((sum, l) => sum + Number(l.debit) + Number(l.credit), 0)

  const daysDiff = Math.abs((tx.date.getTime() - entry.date.getTime()) / 86400000)
  score += Math.max(0, 30 * (1 - daysDiff))

  const amountDiff = Math.abs(txAmount - entryAmount)
  if (amountDiff < 0.01) score += 40
  else if (amountDiff < 1) score += 20
  else if (amountDiff < 10) score += 10

  if (tx.merchant && entry.description?.toLowerCase().includes(tx.merchant.toLowerCase())) {
    score += 30
  }

  return Math.min(100, score)
}

async function suggestEntry(tx: FeedTxWithConnection): Promise<{ confidence: number; entry: MatchResult['suggestedEntry'] }> {
  const bankAccountId = tx.connection?.accountId || ''

  // Check for learned merchant preferences
  const preference = await getMerchantPreference(tx.merchant || tx.description)
  const targetAccountId = preference?.accountId || ''

  // If we have learned preference, use it with high confidence
  if (targetAccountId) {
    return {
      confidence: 90,
      entry: {
        date: tx.date.toISOString().split('T')[0],
        description: tx.merchant || tx.description,
        lines: [
          { accountId: bankAccountId, debit: Number(tx.amount), credit: 0 },
          { accountId: targetAccountId, debit: 0, credit: Number(tx.amount) },
        ],
      },
    }
  }

  const revenueAccount = await prisma.account.findFirst({ where: { type: 'REVENUE' } })
  const expenseAccount = await prisma.account.findFirst({ where: { type: 'EXPENSE' } })

  if (Number(tx.amount) > 0) {
    return {
      confidence: 60,
      entry: {
        date: tx.date.toISOString().split('T')[0],
        description: tx.merchant || tx.description,
        lines: [
          { accountId: bankAccountId, debit: Number(tx.amount), credit: 0 },
          { accountId: revenueAccount?.id || '', debit: 0, credit: Number(tx.amount) },
        ],
      },
    }
  }

  return {
    confidence: 50,
    entry: {
      date: tx.date.toISOString().split('T')[0],
      description: tx.merchant || tx.description,
      lines: [
        { accountId: expenseAccount?.id || '', debit: Number(tx.amount), credit: 0 },
        { accountId: bankAccountId, debit: 0, credit: Number(tx.amount) },
      ],
    },
  }
}