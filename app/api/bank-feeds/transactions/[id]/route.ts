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

// Handle pending transaction lifecycle: pre-auth vs final state
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const body = await request.json()
    const { status, journalEntryId } = body

    if (!status) {
      return NextResponse.json({ error: 'status required' }, { status: 400 })
    }

    // Validate status
    if (!['pending', 'matched', 'posted', 'ignored', 'preauth'].includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }

    const updateData: Record<string, unknown> = { status }
    if (journalEntryId) {
      updateData.journalEntryId = journalEntryId
    }

    const tx = await prisma.feedTransaction.update({
      where: { id },
      data: updateData,
    })

    return NextResponse.json(tx)
  } catch (error) {
    console.error('Status update error:', error)
    return NextResponse.json({ error: 'Failed to update status' }, { status: 500 })
  }
}