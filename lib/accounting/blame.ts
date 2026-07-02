// lib/accounting/blame.ts
// Git Model - blame / history for an account
// See docs/Git-Model-*.md

import { prisma } from '@/lib/prisma'

export interface BlameEntry {
  eventId: string
  createdAt: string
  type: string
  description?: string
  delta: number
  journalEntryId?: string
}

export async function blameAccount(accountCode: string, asOf?: string): Promise<BlameEntry[]> {
  const account = await prisma.account.findUnique({ where: { code: accountCode } })
  if (!account) throw new Error('Account not found')

  const where: any = { accountId: account.id }
  if (asOf) {
    where.journalEntry = { date: { lte: new Date(asOf) } }
  }

  const lines = await prisma.journalLine.findMany({
    where,
    include: {
      journalEntry: { select: { id: true, description: true, date: true } }
    },
    orderBy: { journalEntry: { date: 'asc' } }
  })

  // Map to blame entries using the latest event around the journal entry time as a proxy
  const result: BlameEntry[] = []
  for (const l of lines) {
    const d = Number(l.debit)
    const c = Number(l.credit)
    const delta = (['ASSET', 'EXPENSE'].includes(account.type)) ? (d - c) : (c - d)

    const ev = await prisma.event.findFirst({
      where: { createdAt: { lte: l.journalEntry.date } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, eventType: true, createdAt: true, payload: true }
    })

    const payloadDesc = (ev?.payload as any)?.description || (ev?.payload as any)?.journalEntry?.description
    result.push({
      eventId: ev?.id || 'unknown',
      createdAt: (l.journalEntry.date || ev?.createdAt || new Date()).toISOString(),
      type: ev?.eventType || 'JOURNAL',
      description: l.journalEntry.description || payloadDesc || undefined,
      delta: parseFloat(delta.toFixed(2)),
      journalEntryId: l.journalEntry.id
    })
  }

  return result
}
