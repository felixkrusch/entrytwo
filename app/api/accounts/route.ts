import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { getVisibleJournalEntryIds, getVisibleJournalEntryIdsAtPoint } from '@/lib/accounting/ancestry'

const createAccountSchema = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(100),
  type: z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']),
})

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const branchParam = url.searchParams.get('branch') || 'main'
    const asOf = url.searchParams.get('asOf') || url.searchParams.get('asof')

    // Git ancestry-based visibility (current head or pinned asOf)
    // Graceful fallback: if ancestry gives no visible ids (legacy data, or head with no journal ancestry yet), show everything for current view.
    let visibleEntryIds: string[] = []
    let restrictLines = false
    if (asOf) {
      const { getVisibleJournalEntryIdsAtPoint } = await import('@/lib/accounting/ancestry')
      visibleEntryIds = await getVisibleJournalEntryIdsAtPoint(asOf)
      restrictLines = true
    } else {
      const { getVisibleJournalEntryIds } = await import('@/lib/accounting/ancestry')
      const br = await prisma.accountingBranch.findUnique({ where: { name: branchParam } })
      visibleEntryIds = await getVisibleJournalEntryIds(br?.headEventId)
      restrictLines = visibleEntryIds.length > 0
    }

    const lineWhere: any = restrictLines && visibleEntryIds.length > 0
      ? { journalEntryId: { in: visibleEntryIds } }
      : {}  // show all lines for this account when no ancestry restriction applies yet

    const accounts = await prisma.account.findMany({
      orderBy: { code: 'asc' },
      include: {
        journalLines: {
          where: lineWhere,
          select: { debit: true, credit: true, account: { select: { type: true } } }
        }
      }
    })

    const withBalances = accounts.map(acc => {
      let bal = 0
      for (const l of acc.journalLines) {
        const d = Number(l.debit)
        const c = Number(l.credit)
        if (['ASSET', 'EXPENSE'].includes(acc.type)) bal += d - c
        else bal += c - d
      }
      const visibleCount = acc.journalLines.length
      const { journalLines: _jl, ...rest } = acc as any
      return {
        ...rest,
        _count: { journalLines: visibleCount },
        balance: parseFloat(bal.toFixed(2))
      }
    })

    return NextResponse.json(withBalances)
  } catch (error) {
    console.error('Error fetching accounts:', error)
    return NextResponse.json(
      { error: 'Failed to fetch accounts' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const parsed = createAccountSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid account data', details: parsed.error.format() },
        { status: 400 }
      )
    }

    const { code, name, type } = parsed.data

    const existing = await prisma.account.findUnique({ where: { code } })
    if (existing) {
      return NextResponse.json({ error: 'Account code already exists' }, { status: 409 })
    }

    const account = await prisma.account.create({
      data: { code, name, type },
      include: {
        _count: { select: { journalLines: true } }
      }
    })

    await prisma.event.create({
      data: {
        eventType: 'ACCOUNT_CREATED',
        entityType: 'Account',
        entityId: account.id,
        payload: { code, name, type },
      },
    })

    return NextResponse.json(account, { status: 201 })
  } catch (error: unknown) {
    const err = error as { code?: string }
    if (err.code === 'P2002') {
      return NextResponse.json({ error: 'Account code already exists' }, { status: 409 })
    }
    console.error('Error creating account:', error)
    return NextResponse.json({ error: 'Failed to create account' }, { status: 500 })
  }
}
