import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { findMatch } from '@/lib/matching'
import type { FeedTransaction } from '@prisma/client'
import { requireUser } from '@/lib/authz'
import { logger } from '@/lib/logger'

interface FeedTxWithConn extends FeedTransaction {
  connection: { accountId: string; provider: string | null } | null
  lines?: unknown[]
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!await requireUser(['ADMIN'])) return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  const { id } = await params

  const transaction = await prisma.feedTransaction.findUnique({
    where: { id },
    include: { connection: { include: { account: true } } },
  })

  if (!transaction) {
    return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
  }

  const feedTx: FeedTxWithConn = {
    ...transaction,
    date: transaction.date,
    lines: [],
  }
  const match = await findMatch(feedTx)

  return NextResponse.json({ ...transaction, match: match || null })
}

// Handle pending transaction lifecycle: pre-auth vs final state
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!await requireUser(['ADMIN'])) return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
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
    logger.error('Status update error', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ error: 'Failed to update status' }, { status: 500 })
  }
}
