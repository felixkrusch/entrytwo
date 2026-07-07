import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { findMatch, learnMerchant } from '@/lib/matching'
import type { FeedTransaction } from '@prisma/client'
import { recordCommitOnBranch } from '@/lib/accounting/commit'

interface FeedTxWithConn extends FeedTransaction {
  connection: { accountId: string; provider: string | null } | null
  lines?: unknown[]
}

export async function POST(request: Request) {
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
        // Normalize to business date (midnight UTC of the given day)
        const businessDate = new Date(match.suggestedEntry.date)
        businessDate.setUTCHours(0, 0, 0, 0)

        const entry = await prisma.journalEntry.create({
          data: {
            date: businessDate,
            description: match.suggestedEntry.description,
            lines: {
              create: match.suggestedEntry.lines.map(l => ({
                accountId: l.accountId,
                debit: l.debit,
                credit: l.credit,
                currency: tx.currency,
                fxRateToBase: tx.fxRateToBase ? Number(tx.fxRateToBase) : undefined,
                fxSource: `BANK_FEED:${tx.connection?.provider}`,
                fxDate: new Date(tx.date),
              })),
            },
          },
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

        // Git Model: feed match post follows current head of main (or could take branch from body)
        await recordCommitOnBranch(entry.id, 'main')

        return NextResponse.json({ status: 'posted', entryId: entry.id })
      }
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Feed match error:', error)
    return NextResponse.json({ error: 'Failed to process transaction' }, { status: 500 })
  }
}