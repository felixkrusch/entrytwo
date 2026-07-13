import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/authz'

export async function GET() {
  if (!await requireUser(['ADMIN'])) return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
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
