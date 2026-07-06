// lib/accounting/snapshot.ts
// Git Model for Accounting - Snapshot service
// See docs/Git-Model-for-Accounting.md

import { prisma } from '@/lib/prisma'

export interface SnapshotData {
  // Minimal viable state for replay + balances
  // We capture a point-in-time view of key data
  accounts: Array<{
    id: string
    code: string
    name: string
    type: string
  }>
  journalLines: Array<{
    id: string
    journalEntryId: string
    accountId: string
    debit: string | number
    credit: string | number
    currency?: string | null
    fxRateToBase?: string | number | null
  }>
  // Future: open invoices, feed tx, etc. Start minimal.
  capturedAt: string
  upToEventId?: string | null
}

/**
 * Create a snapshot of the current accounting state.
 * This is the foundation for fast restore / replay in the Git model.
 */
export async function createSnapshot(upToEventId?: string): Promise<string> {
  const accounts = await prisma.account.findMany({
    select: { id: true, code: true, name: true, type: true },
  })

  // For now, capture recent journal lines (last N is fine for start; later we can be smarter)
  const journalLines = await prisma.journalLine.findMany({
    take: 5000, // practical starting limit
    orderBy: { id: 'desc' },
    select: {
      id: true,
      journalEntryId: true,
      accountId: true,
      debit: true,
      credit: true,
      currency: true,
      fxRateToBase: true,
    },
  })

  const data: SnapshotData = {
    accounts,
    journalLines: journalLines.map(l => ({
      ...l,
      debit: l.debit.toString(),
      credit: l.credit.toString(),
      fxRateToBase: l.fxRateToBase ? l.fxRateToBase.toString() : null,
    })),
    capturedAt: new Date().toISOString(),
    upToEventId: upToEventId || null,
  }

  const snapshot = await prisma.snapshot.create({
    data: {
      data: data as any,
      upToEventId: upToEventId || null,
    },
  })

  return snapshot.id
}

export async function getLatestSnapshot(): Promise<{ id: string; data: SnapshotData } | null> {
  const snap = await prisma.snapshot.findFirst({
    orderBy: { createdAt: 'desc' },
  })
  if (!snap) return null
  return {
    id: snap.id,
    data: snap.data as unknown as SnapshotData,
  }
}
