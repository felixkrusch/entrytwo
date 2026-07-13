import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { findMatch, learnMerchant } from '@/lib/matching'
import type { FeedTransaction } from '@prisma/client'
import { requireUser } from '@/lib/authz'
import { commitJournalAtomic } from '@/lib/accounting/atomicCommit'
import { getCompanyProfile } from '@/lib/companyProfile'
import { logger } from '@/lib/logger'

interface FeedTxWithConn extends FeedTransaction {
  connection: { accountId: string; provider: string | null } | null
  lines?: unknown[]
}

export async function POST(request: Request) {
  const session = await requireUser(['ADMIN'])
  if (!session) return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  try {
    const body = await request.json()
    const { transactionId, action } = body

    const tx = await prisma.feedTransaction.findUnique({
      where: { id: transactionId },
      include: { connection: { include: { account: true } } },
    })

    if (!tx) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
    }

    if (action === 'ignore') {
      await prisma.feedTransaction.update({
        where: { id: transactionId },
        data: { status: 'ignored' },
      })
      return NextResponse.json({ status: 'ignored' })
    }

    if (action === 'match') {
      const feedTx: FeedTxWithConn = {
        ...tx,
        date: new Date(tx.date),
        lines: [],
      }
      const match = await findMatch(feedTx)

      if (match?.suggestedEntry) {
        const baseCurrency = (await getCompanyProfile()).baseCurrency.toUpperCase()
        const entry = await commitJournalAtomic({
          date: match.suggestedEntry.date,
          description: match.suggestedEntry.description,
          branch: typeof body.branch === 'string' ? body.branch : 'main',
          baseCurrency,
          createdBy: session.user.id,
          idempotencyKey: `feed-match:${transactionId}`,
          eventPayload: { source: 'feed_match', feedTransactionId: transactionId, provider: tx.connection?.provider },
          lines: match.suggestedEntry.lines.map(line => ({
            accountId: line.accountId,
            debit: line.debit,
            credit: line.credit,
            currency: tx.currency,
            fxRateToBase: tx.currency === baseCurrency ? 1 : (tx.fxRateToBase ? Number(tx.fxRateToBase) : null),
            fxSource: tx.currency === baseCurrency ? 'BASE_CURRENCY' : `BANK_FEED:${tx.connection?.provider}:${tx.externalId}`,
            fxDate: tx.date,
          })),
        })

        // Learn merchant pattern for higher confidence next time
        const creditLine = match.suggestedEntry.lines.find(l => Number(l.credit) > 0)
        if (creditLine?.accountId && tx.merchant) {
          await learnMerchant(tx.merchant, creditLine.accountId)
        }

        await prisma.feedTransaction.update({
          where: { id: transactionId },
          data: { status: 'posted', journalEntryId: entry.id },
        })

        return NextResponse.json({ status: 'posted', entryId: entry.id })
      }
    }

        return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    logger.error('Feed match error', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ error: 'Failed to process transaction' }, { status: 500 })
  }
}
