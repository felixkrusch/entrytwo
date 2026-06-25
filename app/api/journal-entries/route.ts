import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

  const createEntrySchema = z.object({
  date: z.string().refine((d) => !isNaN(Date.parse(d)), { message: 'Invalid date format' }),
  description: z.string().optional(),
  lines: z.array(z.object({
    accountId: z.string().uuid({ message: 'accountId must be a valid UUID' }),
    debit: z.number().min(0),
    credit: z.number().min(0),
    description: z.string().optional(),
    taxRateId: z.string().uuid().optional(),
    taxIsInput: z.boolean().optional(),
    currency: z.string().min(3).max(3).optional(),   // ISO-4217
    fxRateToBase: z.number().positive().optional(),
    fxSource: z.string().optional(),
    fxDate: z.string().refine((d) => !isNaN(Date.parse(d)), { message: 'Invalid fxDate' }).optional(),
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
              select: { id: true, jurisdiction: true, name: true, rate: true, taxType: true }
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

    // FX-aware balancing + auto rate derivation (Phase 0):
    // - If any foreign-currency line is missing fxRateToBase, look for a line in EUR/base with a matching amount
    //   and derive the rate (baseAmount / foreignAmount).
    // - We also set a reasonable fxDate (entry date) and source if not provided.
    const entryDate = date

    // Collect potential foreign and base lines
    const foreignLines = lines.filter(l => (l.currency || 'EUR').toUpperCase() !== 'EUR')
    const baseLines = lines.filter(l => (l.currency || 'EUR').toUpperCase() === 'EUR')

    for (const f of foreignLines) {
      if (f.fxRateToBase != null) continue

      const fAmt = Math.max(f.debit || 0, f.credit || 0)
      if (fAmt <= 0) continue

      // Try to find a base line whose amount we can treat as the exact base equivalent
      for (const b of baseLines) {
        const bAmt = Math.max(b.debit || 0, b.credit || 0)
        if (bAmt <= 0) continue

        // Heuristic: if amounts are close in "economic size" after a typical rate band, or the user
        // explicitly put two different amounts on purpose, we accept it as the pair.
        const ratio = bAmt / fAmt
        const plausible = ratio > 0.1 && ratio < 10 // very loose; real rates are ~0.7-1.5 for major pairs

        if (plausible) {
          const derived = bAmt / fAmt
          if (isFinite(derived) && derived > 0) {
            f.fxRateToBase = derived
            f.fxSource = f.fxSource || 'DERIVED_FROM_ENTRY'
            f.fxDate = f.fxDate || entryDate
            break
          }
        }
      }
    }

    const toBase = (line: { currency?: string | null; fxRateToBase?: number | string | null }, amount: number): number => {
      const cur = (line.currency || 'EUR').toUpperCase()
      if (cur === 'EUR') return amount
      const rate = line.fxRateToBase != null ? Number(line.fxRateToBase) : null
      return rate != null && isFinite(rate) ? amount * rate : amount
    }

    const baseDebits = lines.reduce((sum, l) => sum + toBase(l, l.debit), 0)
    const baseCredits = lines.reduce((sum, l) => sum + toBase(l, l.credit), 0)

    if (Math.abs(baseDebits - baseCredits) > 0.005 || baseDebits === 0) {
      return NextResponse.json(
        { error: 'Debits must equal credits (in base currency) and be greater than zero' },
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
              taxIsInput: typeof line.taxIsInput === 'boolean' ? line.taxIsInput : null,
              currency: line.currency || 'EUR',
              fxRateToBase: line.fxRateToBase != null ? line.fxRateToBase : null,
              fxSource: line.fxSource || null,
              fxDate: line.fxDate ? new Date(line.fxDate) : null,
            }))
          }
        },
        include: {
          lines: {
            include: {
              account: { select: { code: true, name: true } },
              taxRate: { select: { id: true, jurisdiction: true, name: true, rate: true, taxType: true } }
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
              currency: l.currency,
              fxRateToBase: l.fxRateToBase != null ? Number(l.fxRateToBase) : null,
              fxSource: l.fxSource,
              fxDate: l.fxDate ? l.fxDate.toISOString().slice(0, 10) : null,
            }))
          },
          // createdBy will be filled when we have auth
        }
      })

      return created
    })

    return NextResponse.json(entry, { status: 201 })
  } catch (error: unknown) {
    console.error('Error creating journal entry:', error)

    const err = error as { code?: string; message?: string }
    if (err?.code === 'P2025') {
      return NextResponse.json({ error: 'Referenced account or tax rate not found' }, { status: 404 })
    }
    if (err?.code === 'P2002') {
      return NextResponse.json({ error: 'Duplicate entry conflict' }, { status: 409 })
    }

    // Surface Zod-like or balance issues if they bubbled (defensive)
    if (err?.message?.includes('Debits must equal')) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }

    return NextResponse.json(
      { error: 'Failed to create journal entry' },
      { status: 500 }
    )
  }
}
