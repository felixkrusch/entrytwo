// lib/accounting/replay.ts
// Git Model for Accounting - Replay / Reconstruct engine
// Given a snapshot + events after it, reconstruct state at a point in time.
// See docs/Git-Model-for-Accounting.md and docs/Git-Model-Implementation-Plan.md

import { prisma } from '@/lib/prisma'
import type { SnapshotData } from './snapshot'

export interface ReconstructedState {
  balances: Record<string, { base: number; native: number; currency: string }>
  asOfEventId?: string | null
  asOfDate?: string | null
}

/**
 * Very simplified replay for balances.
 * In a full implementation this would also reconstruct open items, etc.
 *
 * Accepts either:
 *  - a snapshotId (preferred for speed), or
 *  - an eventId (will find nearest prior snapshot or synthesize from history).
 *
 * Git model: supports point-in-time reconstruction for any branch head / asOf.
 */
export async function replayToPoint(
  point: string,
  targetEventId?: string
): Promise<ReconstructedState> {
  // Try as snapshot first
  let snapshot = await prisma.snapshot.findUnique({ where: { id: point } })
  let effectiveTarget = targetEventId || point // if point was event, use it as upper bound

  if (!snapshot) {
    // Treat point as eventId or head; synthesize state up to that point from full history (or nearest snapshot)
    const candidateEvent = await prisma.event.findUnique({ where: { id: point } })
    if (candidateEvent) {
      effectiveTarget = targetEventId || point
      // Find nearest prior snapshot (if any)
      snapshot = await prisma.snapshot.findFirst({
        where: { createdAt: { lte: candidateEvent.createdAt } },
        orderBy: { createdAt: 'desc' }
      })
    }
  }

  // If still no snapshot, we will build from scratch using all journal lines up to the target time
  const balances: Record<string, { base: number; native: number; currency: string }> = {}

  let baseTime: Date | null = null

  if (snapshot) {
    const snapData = snapshot.data as unknown as SnapshotData
    for (const acc of snapData.accounts) {
      balances[acc.code] = { base: 0, native: 0, currency: 'EUR' }
    }
    for (const line of snapData.journalLines) {
      const code = snapData.accounts.find(a => a.id === line.accountId)?.code
      if (!code) continue
      const debit = Number(line.debit)
      const credit = Number(line.credit)
      const cur = (line.currency || 'EUR').toUpperCase()
      const rate = line.fxRateToBase != null ? Number(line.fxRateToBase) : 1
      const baseD = cur === 'EUR' ? debit : debit * rate
      const baseC = cur === 'EUR' ? credit : credit * rate
      if (!balances[code]) balances[code] = { base: 0, native: 0, currency: cur }
      balances[code].base += baseD - baseC
      balances[code].native += debit - credit
      balances[code].currency = cur
    }
    baseTime = snapshot.createdAt
  } else {
    // No snapshot: start empty; we will load all journal lines up to target
    baseTime = new Date(0)
  }

  // Determine upper bound time
  let upperBound: Date | null = null
  if (effectiveTarget) {
    const tEv = await prisma.event.findUnique({ where: { id: effectiveTarget } })
    if (tEv) upperBound = tEv.createdAt
  }

  // Load journal lines up to the point (using date <= upperBound or all if no bound)
  const journalLines = await prisma.journalLine.findMany({
    where: upperBound ? {
      journalEntry: { date: { lte: upperBound } }
    } : {},
    include: {
      account: { select: { code: true, type: true } },
      journalEntry: { select: { date: true } }
    },
    orderBy: { journalEntry: { date: 'asc' } }
  })

  // Apply all lines (if we started from snapshot we already have the base; to keep simple we re-apply everything deterministically when no good snapshot)
  // When we had a snapshot we still need to apply lines after snapshot time.
  for (const line of journalLines) {
    const code = line.account.code
    if (!code) continue
    if (!balances[code]) balances[code] = { base: 0, native: 0, currency: 'EUR' }

    const d = Number(line.debit)
    const c = Number(line.credit)
    const cur = (line.currency || 'EUR').toUpperCase() // note: journalLine may not have currency on line in some schemas; safe default
    const rate = (line as any).fxRateToBase != null ? Number((line as any).fxRateToBase) : 1
    const baseD = cur === 'EUR' ? d : d * rate
    const baseC = cur === 'EUR' ? c : c * rate

    if (baseTime && line.journalEntry?.date && line.journalEntry.date <= baseTime) {
      // already included via snapshot; skip to avoid double count when snapshot present
      continue
    }

    balances[code].base += baseD - baseC
    balances[code].native += d - c
    balances[code].currency = cur
  }

  // Also apply any relevant post-snapshot events if target specified (for payload-based journal events)
  if (effectiveTarget) {
    const eventsAfter = await prisma.event.findMany({
      where: {
        ...(baseTime ? { createdAt: { gte: baseTime } } : {}),
        id: { lte: effectiveTarget },
        eventType: { in: ['JOURNAL_ENTRY_CREATED', 'JOURNAL_ENTRY_REVERSED'] },
      },
      orderBy: { createdAt: 'asc' }
    })

    for (const ev of eventsAfter) {
      const payloadLines = (ev.payload as any)?.lines || []
      for (const l of payloadLines) {
        const code = typeof l.account === 'string' ? l.account : l.accountCode
        if (!code || !balances[code]) continue
        const d = Number(l.debit || 0)
        const c = Number(l.credit || 0)
        if (ev.eventType === 'JOURNAL_ENTRY_REVERSED') {
          balances[code].base -= (d - c)
          balances[code].native -= (d - c)
        } else {
          balances[code].base += (d - c)
          balances[code].native += (d - c)
        }
      }
    }
  }

  return {
    balances,
    asOfEventId: effectiveTarget || null,
    asOfDate: upperBound ? upperBound.toISOString() : new Date().toISOString(),
  }
}
