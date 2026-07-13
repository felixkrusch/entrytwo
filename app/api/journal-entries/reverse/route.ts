import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { requireUser } from '@/lib/authz'
import { commitJournalAtomic } from '@/lib/accounting/atomicCommit'

const reverseSchema = z.object({
  originalId: z.string(),
  branch: z.string().optional()
})

export async function POST(request: Request) {
  const session = await requireUser(['ADMIN', 'ACCOUNTANT'])
  if (!session) return NextResponse.json({ error: 'Accountant access required' }, { status: 403 })
  try {
    const body = await request.json()
    const parsed = reverseSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid data' }, { status: 400 })
    }

    const { originalId } = parsed.data

    const original = await prisma.journalEntry.findUnique({
      where: { id: originalId },
      include: {
        lines: {
          include: { account: { select: { code: true } } }
        }
      }
    })

    if (!original) {
      return NextResponse.json({ error: 'Original entry not found' }, { status: 404 })
    }

    const branchForCommit = (body.branch || 'main') as string
    const reversingEntry = await commitJournalAtomic({
      date: new Date(),
      description: `Reversal of ${original.entryNumber || original.description || original.id}`,
      branch: branchForCommit,
      createdBy: session.user.id,
      eventType: 'JOURNAL_ENTRY_REVERSED',
      idempotencyKey: `journal-reversal:${originalId}:${branchForCommit}`,
      eventPayload: { originalId, originalEntryId: originalId },
      lines: original.lines.map(line => ({
        accountId: line.accountId,
        debit: Number(line.credit),
        credit: Number(line.debit),
        description: `Reversal: ${line.description || ''}`,
        currency: line.currency || 'EUR',
        taxRateId: line.taxRateId || null,
        taxIsInput: line.taxIsInput,
        fxRateToBase: line.fxRateToBase != null ? Number(line.fxRateToBase) : null,
        fxSource: line.fxSource || null,
        fxDate: line.fxDate || null,
        contactId: line.contactId || null,
      })),
    })

    return NextResponse.json(reversingEntry, { status: 201 })
  } catch (error) {
    console.error('Reverse error:', error)
    return NextResponse.json({ error: 'Failed to reverse entry' }, { status: 500 })
  }
}
