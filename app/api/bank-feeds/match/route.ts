import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { findMatch } from '@/lib/matching'

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
      const match = await findMatch({
        ...tx,
        date: new Date(tx.date),
        lines: [],
      } as any)

      if (match?.suggestedEntry) {
        const entry = await prisma.journalEntry.create({
          data: {
            date: new Date(match.suggestedEntry.date),
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

        await prisma.feedTransaction.update({
          where: { id: transactionId },
          data: { status: 'posted', journalEntryId: entry.id },
        })

        return NextResponse.json({ status: 'posted', entryId: entry.id })
      }
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Feed match error:', error)
    return NextResponse.json({ error: 'Failed to process transaction' }, { status: 500 })
  }
}