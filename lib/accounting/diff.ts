// lib/accounting/diff.ts
// Git Model - basic diff between two points
// Returns net changes per account + list of relevant events
// See docs/Git-Model-*.md

import { prisma } from '@/lib/prisma'

export interface DiffResult {
  from: string
  to: string
  changes: Array<{ accountCode: string; accountName: string; net: number }>
  events: Array<{ id: string; type: string; createdAt: string; description?: string }>
}

export async function diffPoints(fromEventId: string, toEventId: string): Promise<DiffResult> {
  const fromEvent = await prisma.event.findUnique({ where: { id: fromEventId } })
  const toEvent = await prisma.event.findUnique({ where: { id: toEventId } })
  if (!fromEvent || !toEvent) throw new Error('Events not found')

  // For foundation: compute balance delta between the two times using replay-style aggregation
  // Simpler: get all journal lines created between the two event times (by event creation time approximation via journalEntry dates)
  // Better approximation: use createdAt on JournalEntry via its linked events if available; fall back to date range.
  const fromTime = fromEvent.createdAt
  const toTime = toEvent.createdAt

  const lines = await prisma.journalLine.findMany({
    where: {
      journalEntry: {
        date: { gte: fromTime, lte: toTime }
      }
    },
    include: {
      account: true,
      journalEntry: { select: { description: true, date: true } }
    }
  })

  const changesMap: Record<string, { code: string; name: string; net: number }> = {}
  lines.forEach(l => {
    const key = l.account.code
    if (!changesMap[key]) changesMap[key] = { code: l.account.code, name: l.account.name, net: 0 }
    const d = Number(l.debit)
    const c = Number(l.credit)
    const delta = (['ASSET', 'EXPENSE'].includes(l.account.type)) ? (d - c) : (c - d)
    changesMap[key].net += delta
  })

  const events = await prisma.event.findMany({
    where: { createdAt: { gte: fromTime, lte: toTime } },
    orderBy: { createdAt: 'asc' },
    take: 200,
    select: { id: true, eventType: true, createdAt: true, payload: true }
  })

  return {
    from: fromEventId,
    to: toEventId,
    changes: Object.values(changesMap).map(v => ({ accountCode: v.code, accountName: v.name, net: parseFloat(v.net.toFixed(2)) })),
    events: events.map(e => {
      const p = (e.payload as any) || {}
      return { id: e.id, type: e.eventType, createdAt: e.createdAt.toISOString(), description: p.description || p.journalEntry?.description || undefined }
    })
  }
}
