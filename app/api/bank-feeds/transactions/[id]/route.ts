import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { findMatch } from '@/lib/matching'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const transaction = await prisma.feedTransaction.findUnique({
    where: { id },
    include: { connection: { include: { account: true } } },
  })

  if (!transaction) {
    return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
  }

  const match = await findMatch({
    ...transaction,
    date: transaction.date,
    lines: [],
  } as any)

  return NextResponse.json({ ...transaction, match: match || null })
}