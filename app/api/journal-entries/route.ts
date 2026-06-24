import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const createEntrySchema = z.object({
  date: z.string(),
  description: z.string().optional(),
  lines: z.array(z.object({
    accountId: z.string(),
    debit: z.number().min(0),
    credit: z.number().min(0),
    description: z.string().optional(),
    taxRateId: z.string().optional(),
    currency: z.string().optional(),   // multi-currency foundation
  })).min(2)
})

export async function GET() {
  try {
    const entries = await prisma.journalEntry.findMany({
      orderBy: { date: 'desc' },
      take: 20,
      include: {
        lines: {
          include: {
            account: {
              select: { code: true, name: true }
            },
            taxRate: {
              select: { id: true, jurisdiction: true, name: true, rate: true, taxType: true, isInputTax: true }
            }
          }
        }
      }
    })
    return NextResponse.json(entries)
  } catch (error) {
    console.error('Error fetching journal entries:', error)
    return NextResponse.json(
      { error: 'Failed to fetch journal entries' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const parsed = createEntrySchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid data', details: parsed.error.format() },
        { status: 400 }
      )
    }

    const { date, description, lines } = parsed.data

    const totalDebits = lines.reduce((sum, l) => sum + l.debit, 0)
    const totalCredits = lines.reduce((sum, l) => sum + l.credit, 0)

    if (totalDebits !== totalCredits || totalDebits === 0) {
      return NextResponse.json(
        { error: 'Debits must equal credits and be greater than zero' },
        { status: 400 }
      )
    }

    // Create journal entry + audit event in a transaction
    const entry = await prisma.$transaction(async (tx) => {
      const created = await tx.journalEntry.create({
        data: {
          date: new Date(date),
          description,
          lines: {
            create: lines.map(line => ({
              accountId: line.accountId,
              debit: line.debit,
              credit: line.credit,
              description: line.description,
              taxRateId: line.taxRateId || null,
              currency: line.currency || 'EUR'   // multi-currency foundation (default base)
            }))
          }
        },
        include: {
          lines: {
            include: {
              account: { select: { code: true, name: true } },
              taxRate: { select: { id: true, jurisdiction: true, name: true, rate: true, taxType: true, isInputTax: true } }
            }
          }
        }
      })

      // Write audit event (Phase 0 requirement)
      await tx.event.create({
        data: {
          eventType: 'JOURNAL_ENTRY_CREATED',
          entityType: 'JournalEntry',
          entityId: created.id,
          payload: {
            description: created.description,
            date: created.date,
            lines: created.lines.map(l => ({
              account: l.account.code,
              debit: Number(l.debit),
              credit: Number(l.credit),
              currency: l.currency
            }))
          },
          // createdBy will be filled when we have auth
        }
      })

      return created
    })

    return NextResponse.json(entry, { status: 201 })
  } catch (error) {
    console.error('Error creating journal entry:', error)
    return NextResponse.json(
      { error: 'Failed to create journal entry' },
      { status: 500 }
    )
  }
}
