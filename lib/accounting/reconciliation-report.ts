// lib/accounting/reconciliation-report.ts
// Git Model: produce a classical-style reconciliation report from a reconciliation result
// See docs/Git-Model-for-Accounting.md

import { prisma } from '@/lib/prisma'

export interface ReconciliationReport {
  accountCode: string
  period: { from: string; to: string }
  statementBalance: number
  ledgerBalance: number
  cleared: number
  outstanding: number
  adjustments: Array<{ id: string; description: string; amount: number }>
  tieOut: boolean
  generatedAt: string
  performedBy: string
  summary: string
}

export async function generateReconciliationReport(
  accountCode: string,
  result: { ledgerBalance: number; differences: Array<{ description: string; amount: number; type: string }>; createdEntryIds: string[]; reportSummary: string }
): Promise<ReconciliationReport> {
  const account = await prisma.account.findUnique({ where: { code: accountCode } })
  if (!account) throw new Error('Account not found')

  const adjustments = await prisma.journalEntry.findMany({
    where: { id: { in: result.createdEntryIds } },
    include: { lines: true },
  })

  const adjustmentList = adjustments.flatMap(e =>
    e.lines.map(l => ({
      id: e.id,
      description: e.description || l.description || '',
      amount: Number(l.debit) - Number(l.credit),
    }))
  )

  const statementBalance = result.ledgerBalance + adjustmentList.reduce((s, a) => s + a.amount, 0)

  const cleared = result.differences.length - adjustmentList.length
  const outstanding = adjustmentList.length

  return {
    accountCode,
    period: { from: 'period-start', to: 'now' },
    statementBalance,
    ledgerBalance: result.ledgerBalance,
    cleared: Math.max(0, cleared),
    outstanding,
    adjustments: adjustmentList,
    tieOut: Math.abs(statementBalance - result.ledgerBalance) < 0.01,
    generatedAt: new Date().toISOString(),
    performedBy: 'AI (Git model)',
    summary: result.reportSummary,
  }
}
