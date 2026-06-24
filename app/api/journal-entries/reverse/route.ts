import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const reverseSchema = z.object({
  originalId: z.string()
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

    const reversingEntry = await prisma.$transaction(async (tx) => {
      const created = await tx.journalEntry.create({
        data: {
          date: new Date(),
          description: `Reversal of ${original.description || original.id}`,
          lines: {
            create: original.lines.map(line => ({
              accountId: line.accountId,
              debit: Number(line.credit),
              credit: Number(line.debit),
              description: `Reversal: ${line.description || ''}`,
              currency: line.currency || 'EUR',   // preserve multi-currency
              taxRateId: line.taxRateId || null,   // preserve tax foundation
              fxRateToBase: line.fxRateToBase != null ? Number(line.fxRateToBase) : null,
              fxSource: line.fxSource || null,
              fxDate: line.fxDate || null,
            }))
          }
        },
        include: {
          lines: {
            include: { account: { select: { code: true, name: true } } }
          }
        }
      })

      await tx.event.create({
        data: {
          eventType: 'JOURNAL_ENTRY_REVERSED',
          entityType: 'JournalEntry',
          entityId: created.id,
          payload: {
            originalId,
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

      return created
    })

    return NextResponse.json(reversingEntry, { status: 201 })
  } catch (error) {
    console.error('Reverse error:', error)
    return NextResponse.json({ error: 'Failed to reverse entry' }, { status: 500 })
  }
}
