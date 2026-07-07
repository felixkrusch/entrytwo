import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { recordCommitOnBranch } from '@/lib/accounting/commit'
import { nextEntryNumber } from '@/lib/accounting/entryNumber'

const reverseSchema = z.object({
  originalId: z.string(),
  branch: z.string().optional()
})

export async function POST(request: Request) {
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

    const entryNumber = await nextEntryNumber(new Date())
    const originalRef = original.entryNumber ? ` (${original.entryNumber})` : ''

    const session = await auth().catch(() => null)
    const createdBy = session?.user?.id || null

    const branchForCommit = (body.branch || 'main') as string
    const br = await prisma.accountingBranch.findUnique({ where: { name: branchForCommit } })
    const parentHead = br?.headEventId || null

    const reversingEntry = await prisma.$transaction(async (tx) => {
      // Business date for the reversal = today at midnight UTC
      const businessDate = new Date()
      businessDate.setUTCHours(0, 0, 0, 0)

      const created = await tx.journalEntry.create({
        data: {
          date: businessDate,
          description: `Reversal of ${original.entryNumber || original.description || original.id}${originalRef}`,
          entryNumber,
          createdBy,
          lines: {
            create: original.lines.map(line => ({
              accountId: line.accountId,
              debit: Number(line.credit),
              credit: Number(line.debit),
              description: `Reversal: ${line.description || ''}`,
              currency: line.currency || 'EUR',
              taxRateId: line.taxRateId || null,
              fxRateToBase: line.fxRateToBase != null ? Number(line.fxRateToBase) : null,
              fxSource: line.fxSource || null,
              fxDate: line.fxDate || null,
              cleared: false,
            }))
          }
        },
        include: {
          lines: {
            include: { account: { select: { code: true, name: true } } }
          }
        }
      })

      const revEvent = await tx.event.create({
        data: {
          eventType: 'JOURNAL_ENTRY_REVERSED',
          entityType: 'JournalEntry',
          entityId: created.id,
          parentEventId: parentHead,
          payload: {
            originalId,
            originalEntryId: originalId,
            description: created.description,
            lines: created.lines.map(l => ({
              account: l.account.code,
              debit: Number(l.debit),
              credit: Number(l.credit),
              currency: l.currency,
              fxRateToBase: l.fxRateToBase != null ? Number(l.fxRateToBase) : null,
              fxSource: l.fxSource,
              fxDate: l.fxDate ? l.fxDate.toISOString().slice(0, 10) : null,
            }))
          }
        }
      })

      // Mark the reversing entry as introduced by this reversal event
      await tx.journalEntry.update({
        where: { id: created.id },
        data: { introducedByEventId: revEvent.id }
      })

      return { created, commitEventId: revEvent.id, branchForCommit }
    })

    const created = (reversingEntry as any).created
    const commitEventId = (reversingEntry as any).commitEventId
    const b = (reversingEntry as any).branchForCommit || branchForCommit

    if (commitEventId) {
      await recordCommitOnBranch(created.id, b, commitEventId)
    } else {
      await recordCommitOnBranch(created.id, b)
    }

    return NextResponse.json(created, { status: 201 })
  } catch (error) {
    console.error('Reverse error:', error)
    return NextResponse.json({ error: 'Failed to reverse entry' }, { status: 500 })
  }
}
