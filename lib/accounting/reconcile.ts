// lib/accounting/reconcile.ts
// Git Model - AI-driven reconciliation service (first implementation)
// Goal: given account(s) + period, analyze feeds vs journal, propose or create fixes.
// See docs/Git-Model-*.md

import { prisma } from '@/lib/prisma'
import { createAutonomousJournal } from './autonomous'
import { generateReconciliationReport } from './reconciliation-report'

export interface ReconcileOptions {
  accountCode?: string
  from?: string
  to?: string
  autoApplyHighConfidence?: boolean
}

export interface ReconciliationResult {
  accountCode: string
  period: { from: string; to: string }
  ledgerBalance: number
  statementBalance?: number
  differences: Array<{ description: string; amount: number; type: string }>
  createdEntryIds: string[]
  reportSummary: string
}

/**
 * Very first version of AI-driven reconciliation.
 * It looks at recent feed transactions for the account and compares to journal lines.
 * For unmatched positive/negative amounts it can create simple clearing entries at high confidence.
 */
export async function reconcileAccount(opts: ReconcileOptions): Promise<ReconciliationResult> {
  const { accountCode = '1100', from, to, autoApplyHighConfidence = true } = opts

  const account = await prisma.account.findUnique({ where: { code: accountCode } })
  if (!account) throw new Error(`Account ${accountCode} not found`)

  const dateFilter: Record<string, Date> = {}
  if (from) dateFilter.gte = new Date(from)
  if (to) dateFilter.lte = new Date(to)

  // Get recent feed transactions for this account (via connections)
  const connections = await prisma.bankConnection.findMany({
    where: { accountId: account.id, syncEnabled: true },
  })
  const connIds = connections.map(c => c.id)

  const feedTxs = await prisma.feedTransaction.findMany({
    where: {
      connectionId: { in: connIds },
      status: { in: ['pending', 'matched'] },
      ...(Object.keys(dateFilter).length ? { date: dateFilter } : {}),
    },
    orderBy: { date: 'asc' },
  })

  // Get journal lines for the account in the period
  const journalLines = await prisma.journalLine.findMany({
    where: {
      accountId: account.id,
      ...(Object.keys(dateFilter).length ? { journalEntry: { date: dateFilter } } : {}),
    },
    include: { journalEntry: true },
  })

  // Very naive difference calculation
  let ledgerDelta = 0
  journalLines.forEach(l => {
    ledgerDelta += Number(l.debit) - Number(l.credit)
  })

  const unmatchedFeeds = feedTxs.filter(ft => ft.status === 'pending')

  const differences: Array<{ description: string; amount: number; type: string }> = []
  const createdEntryIds: string[] = []

  for (const ft of unmatchedFeeds) {
    const amt = Number(ft.amount)
    differences.push({
      description: `Unmatched feed: ${ft.description || ft.merchant || ft.externalId}`,
      amount: amt,
      type: 'feed-unmatched',
    })

    if (autoApplyHighConfidence && Math.abs(amt) > 0) {
      // Create a simple autonomous entry to clear it (bank <-> other)
      // In reality we'd use better heuristics; this is the foundation
      const otherCode = amt > 0 ? '4000' : '5000' // revenue or expense placeholder
      const other = await prisma.account.findFirst({ where: { code: otherCode } })
      if (other) {
        const entry = await createAutonomousJournal({
          date: ft.date.toISOString(),
          description: `Auto-reconciled feed: ${ft.merchant || ft.description}`,
          lines: [
            { accountId: account.id, debit: amt > 0 ? amt : 0, credit: amt < 0 ? Math.abs(amt) : 0, currency: ft.currency },
            { accountId: other.id, debit: amt < 0 ? Math.abs(amt) : 0, credit: amt > 0 ? amt : 0, currency: ft.currency },
          ],
          aiMetadata: {
            confidence: 0.9,
            model: 'reconcile',
            reasoning: 'Unmatched feed transaction cleared automatically at high confidence',
          },
          idempotencyKey: `reconciliation:${ft.id}`,
        })
        createdEntryIds.push(entry.id)
      }
    }
  }

  const reportSummary = `Reconciled ${accountCode}. Ledger delta: ${ledgerDelta}. Unmatched feeds: ${unmatchedFeeds.length}. Created ${createdEntryIds.length} autonomous entries.`

  const base = {
    accountCode,
    period: { from: from || 'earliest', to: to || 'now' },
    ledgerBalance: ledgerDelta,
    differences,
    createdEntryIds,
    reportSummary,
  }

  // Always produce the classical report as the output of AI reconciliation
  const report = await generateReconciliationReport(accountCode, base)

  // Attach the report for consumers (chat, UI, export)
  return {
    ...base,
    report,
  } as ReconciliationResult
}
