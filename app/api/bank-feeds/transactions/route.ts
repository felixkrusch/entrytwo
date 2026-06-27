import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const transactions = await prisma.feedTransaction.findMany({
      include: {
        connection: { include: { account: true } },
        journalEntry: true,
      },
      orderBy: { date: 'desc' },
      take: 100,
    })
    return NextResponse.json(transactions)
  } catch {
    return NextResponse.json({ error: 'Failed to fetch transactions' }, { status: 500 })
  }
}