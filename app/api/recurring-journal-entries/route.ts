import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { createAutonomousJournal } from '@/lib/accounting/autonomous'
import { RECURRING_FREQUENCIES } from '@/lib/accounting/recurring'

const createSchema = z.object({
  name: z.string().min(1),
  frequency: z.enum(RECURRING_FREQUENCIES),
  interval: z.number().int().min(1).max(12).default(1),
  startDate: z.string().refine(d => !isNaN(Date.parse(d)), { message: 'Invalid startDate' }),
  endDate: z.string().refine(d => !isNaN(Date.parse(d)), { message: 'Invalid endDate' }).optional(),
  autoPost: z.boolean().optional(),
  notes: z.string().optional(),
  // The booked lines (accountId based) + currency + optional description
  currency: z.string().min(3).max(3).default('EUR'),
  description: z.string().optional(),
  lines: z.array(z.object({
    accountId: z.string().uuid(),
    debit: z.number().min(0),
    credit: z.number().min(0),
    description: z.string().optional(),
    taxRateId: z.string().uuid().optional(),
    taxIsInput: z.boolean().optional(),
    currency: z.string().min(3).max(3).optional(),
    fxRateToBase: z.number().positive().optional(),
    fxSource: z.string().optional(),
    fxDate: z.string().optional(),
    contactId: z.string().uuid().optional(),
  })).min(2),
  createFirstEntry: z.boolean().optional(), // post the first occurrence immediately
  branch: z.string().optional(),
})

export async function GET() {
  try {
    const schedules = await prisma.recurringJournalEntry.findMany({
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json({ schedules })
  } catch (e) {
    console.error('Error listing recurring journal schedules', e)
    return NextResponse.json({ error: 'Failed to list schedules' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid schedule', details: parsed.error.format() }, { status: 400 })
    }
    const data = parsed.data

    const session = await auth().catch(() => null)
    const createdBy = session?.user?.id || null

    const startDate = new Date(data.startDate)
    const endDate = data.endDate ? new Date(data.endDate) : null

    // Validate base-currency balance of the template lines before saving.
    const toBase = (cur: string | null | undefined, rate: number | null | undefined, amt: number) => {
      const c = (cur || 'EUR').toUpperCase()
      if (c === 'EUR') return amt
      const r = rate != null ? Number(rate) : null
      return r != null && isFinite(r) ? amt * r : amt
    }
    const baseDebits = data.lines.reduce((s, l) => s + toBase(l.currency, l.fxRateToBase, l.debit), 0)
    const baseCredits = data.lines.reduce((s, l) => s + toBase(l.currency, l.fxRateToBase, l.credit), 0)
    if (Math.abs(baseDebits - baseCredits) > 0.005 || baseDebits === 0) {
      return NextResponse.json({ error: 'Schedule lines must balance in base currency' }, { status: 400 })
    }

    const branch = data.branch || 'main'

    const schedule = await prisma.recurringJournalEntry.create({
      data: {
        name: data.name,
        frequency: data.frequency,
        interval: data.interval,
        startDate,
        nextDueDate: startDate,
        endDate,
        status: 'ACTIVE',
        autoPost: data.autoPost ?? false,
        notes: data.notes,
        createdBy,
        templateData: {
          currency: data.currency,
          description: data.description,
          lines: data.lines,
        },
      },
    })

    let firstEntryId: string | null = null
    if (data.createFirstEntry) {
      const created = await createAutonomousJournal({
        date: startDate.toISOString(),
        description: data.description || data.name,
        lines: data.lines.map(l => ({
          accountId: l.accountId,
          debit: l.debit,
          credit: l.credit,
          description: l.description,
          currency: l.currency || data.currency,
          fxRateToBase: l.fxRateToBase ?? null,
          fxSource: l.fxSource || null,
          fxDate: l.fxDate || null,
          taxRateId: l.taxRateId || null,
          taxIsInput: l.taxIsInput ?? null,
          contactId: l.contactId || null,
        })),
        branch,
        createdBy,
        sourcePdfPath: null,
      })
      firstEntryId = created.id
      await prisma.recurringJournalEntry.update({
        where: { id: schedule.id },
        data: { lastGeneratedAt: new Date() },
      })
    }

    return NextResponse.json({ schedule, firstEntryId }, { status: 201 })
  } catch (e) {
    console.error('Error creating recurring journal schedule', e)
    return NextResponse.json({ error: 'Failed to create schedule' }, { status: 500 })
  }
}
