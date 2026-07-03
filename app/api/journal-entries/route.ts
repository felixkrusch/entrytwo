import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { recordCommitOnBranch } from '@/lib/accounting/commit'
import { getVisibleJournalEntryIds, getVisibleJournalEntryIdsAtPoint } from '@/lib/accounting/ancestry'

const createEntrySchema = z.object({
  date: z.string().refine((d) => !isNaN(Date.parse(d)), { message: 'Invalid date format' }),
  description: z.string().optional(),
  sourcePdfPath: z.string().optional(),
  lines: z.array(z.object({
    accountId: z.string().uuid({ message: 'accountId must be a valid UUID' }),
    debit: z.number().min(0),
    credit: z.number().min(0),
    description: z.string().optional(),
    taxRateId: z.string().uuid().optional(),
    taxIsInput: z.boolean().optional(),
    currency: z.string().min(3).max(3).optional(),
    fxRateToBase: z.number().positive().optional(),
    fxSource: z.string().optional(),
    fxDate: z.string().refine((d) => !isNaN(Date.parse(d)), { message: 'Invalid fxDate' }).optional(),
    contactId: z.string().uuid().optional(),
  })).min(2)
})

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)

    const accountCode = searchParams.get('accountCode') || searchParams.get('account')
    const search = (searchParams.get('search') || '').trim()
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
    const limit = Math.min(100, Math.max(5, parseInt(searchParams.get('limit') || '25', 10)))
    const sortParam = searchParams.get('sort') || 'date:desc'
    const [sortField, sortDir] = sortParam.split(':')
    const orderBy: any = sortField === 'date' ? { date: sortDir === 'asc' ? 'asc' : 'desc' } : { date: 'desc' }

    // Git Model: branch + asOf
    // - If asOf: pinned view at that point (uses ancestry of the event at that point)
    // - Else: current view for the branch = entries visible in the ancestor chain of the branch's current head
    const branchParam = searchParams.get('branch') || undefined
    const asOf = searchParams.get('asOf') || searchParams.get('asof') || undefined
    const targetBranch = branchParam || 'main'

    let visibleEntryIds: string[] = []
    let restrictToVisible = false
    if (asOf) {
      visibleEntryIds = await getVisibleJournalEntryIdsAtPoint(asOf)
      restrictToVisible = true
    } else {
      const br = await prisma.accountingBranch.findUnique({ where: { name: targetBranch } })
      visibleEntryIds = await getVisibleJournalEntryIds(br?.headEventId)
      // Only restrict if ancestry gave us a non-empty set. For legacy data with no parents yet, show all for current view.
      restrictToVisible = visibleEntryIds.length > 0
    }

    const where: any = {}
    if (restrictToVisible) {
      if (visibleEntryIds.length > 0) {
        where.id = { in: visibleEntryIds }
      } else {
        where.id = 'no-visible-entries-match'
      }
    }
    // else: no ancestry restriction → show all (legacy current main or no head yet)

    if (from || to) {
      where.date = where.date || {}
      if (from) where.date.gte = new Date(from)
      if (to) where.date.lte = new Date(to)
    }

    if (accountCode) {
      where.lines = {
        some: {
          account: { code: accountCode }
        }
      }
    }

    if (search) {
      where.OR = [
        { description: { contains: search, mode: 'insensitive' } },
        {
          lines: {
            some: {
              description: { contains: search, mode: 'insensitive' }
            }
          }
        }
      ]
    }

    const [total, entries] = await Promise.all([
      prisma.journalEntry.count({ where }),
      prisma.journalEntry.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        include: {
          lines: {
            include: {
              account: { select: { code: true, name: true } },
              taxRate: { select: { id: true, jurisdiction: true, name: true, rate: true, taxType: true } },
              contact: { select: { id: true, name: true, type: true } }
            }
          }
        }
      })
    ])

    // If using ancestry filter, the "total" above is already the visible count for the view.
    // We keep page/limit for UI pagination of the visible set.

    return NextResponse.json({
      entries,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
      // Git model context echoed back
      branch: targetBranch,
      asOf: asOf || null
    })
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

    const { date, description, sourcePdfPath, lines } = parsed.data

    const entryDate = date

    const foreignLines = lines.filter(l => (l.currency || 'EUR').toUpperCase() !== 'EUR')
    const baseLines = lines.filter(l => (l.currency || 'EUR').toUpperCase() === 'EUR')

    for (const f of foreignLines) {
      if (f.fxRateToBase != null) continue

      const fAmt = Math.max(f.debit || 0, f.credit || 0)
      if (fAmt <= 0) continue

      for (const b of baseLines) {
        const bAmt = Math.max(b.debit || 0, b.credit || 0)
        if (bAmt <= 0) continue

        const ratio = bAmt / fAmt
        const plausible = ratio > 0.1 && ratio < 10

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

    const result = await prisma.$transaction(async (tx) => {
      const created = await tx.journalEntry.create({
        data: {
          date: new Date(date),
          description,
          sourcePdfPath: sourcePdfPath || null,
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
              contactId: line.contactId || null,
            }))
          }
        },
        include: {
          lines: {
            include: {
              account: { select: { code: true, name: true } },
              taxRate: { select: { id: true, jurisdiction: true, name: true, rate: true, taxType: true } },
              contact: { select: { id: true, name: true, type: true } }
            }
          }
        }
      })

      // Git Model: determine branch (default main), get current head for ancestry parent
      const branchForCommit = (body.branch || 'main') as string
      const br = await tx.accountingBranch.findUnique({ where: { name: branchForCommit } })
      const parentForNewEvent = br?.headEventId || null

      const createdEvent = await tx.event.create({
        data: {
          eventType: 'JOURNAL_ENTRY_CREATED',
          entityType: 'JournalEntry',
          entityId: created.id,
          parentEventId: parentForNewEvent,
          payload: {
            description: created.description,
            date: created.date,
            lines: created.lines.map(l => ({
              account: l.account.code,
              debit: Number(l.debit),
              credit: Number(l.credit),
              currency: l.currency,
              contact: l.contact?.name,
              fxRateToBase: l.fxRateToBase != null ? Number(l.fxRateToBase) : null,
              fxSource: l.fxSource,
              fxDate: l.fxDate ? l.fxDate.toISOString().slice(0, 10) : null,
            }))
          },
        }
      })

      // Mark the journal entry as introduced by this event (for ancestry visibility)
      await tx.journalEntry.update({
        where: { id: created.id },
        data: { introducedByEventId: createdEvent.id }
      })

      return { createdEntry: created, commitEventId: createdEvent.id, branchForCommit }
    })

    const createdEntry = (result as any).createdEntry
    const commitEventId = (result as any).commitEventId
    const branchForCommit = (result as any).branchForCommit || 'main'

    // Advance branch head using the new commit event (sets parent on the event and advances head)
    if (commitEventId) {
      await recordCommitOnBranch(createdEntry.id, branchForCommit, commitEventId)
    } else {
      await recordCommitOnBranch(createdEntry.id, branchForCommit)
    }

    return NextResponse.json(createdEntry, { status: 201 })
  } catch (error: unknown) {
    console.error('Error creating journal entry:', error)

    const err = error as { code?: string; message?: string }
    if (err?.code === 'P2025') {
      return NextResponse.json({ error: 'Referenced account, tax rate, or contact not found' }, { status: 404 })
    }
    if (err?.code === 'P2002') {
      return NextResponse.json({ error: 'Duplicate entry conflict' }, { status: 409 })
    }

    if (err?.message?.includes('Debits must equal')) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }

    return NextResponse.json(
      { error: 'Failed to create journal entry' },
      { status: 500 }
    )
  }
}