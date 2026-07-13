import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/authz'

export async function GET() {
  if (!await requireUser()) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  try {
    const lines = await prisma.journalLine.findMany({
      where: {
        fxSource: { startsWith: 'BANK_FEED' },
      },
      include: {
        journalEntry: {
          select: { id: true, date: true, description: true },
        },
        account: { select: { code: true, name: true } },
      },
      orderBy: { journalEntry: { date: 'desc' } },
      take: 20,
    })

    const recent = lines.map(l => ({
      journalEntryId: l.journalEntryId,
      date: l.journalEntry.date.toISOString().slice(0, 10),
      description: l.journalEntry.description || l.description || '',
      account: `${l.account?.code} ${l.account?.name}`,
      foreignAmount: Number(l.debit || 0) || Number(l.credit || 0),
      currency: l.currency || 'EUR',
      fxRateToBase: l.fxRateToBase ? Number(l.fxRateToBase) : null,
      fxSource: l.fxSource,
      fxDate: l.fxDate ? l.fxDate.toISOString().slice(0, 10) : null,
    }))

    return NextResponse.json(recent)
  } catch {
    return NextResponse.json({ error: 'Failed to load recent feed rates' }, { status: 500 })
  }
}
