// lib/summary.ts
// Unified dashboard aggregation layer — the SINGLE source of truth for the
// dashboard KPIs and financial-health snapshot. Every page that needs a top-line
// number should read from here so we never drift into per-page double-counting
// (the class of bug that produced mismatched "Total Assets" / "Journal Entries" KPIs).
//
// Reuses the shared report computations in lib/reports.ts so the summary and the
// full reports always agree.

import { prisma } from '@/lib/prisma'
import { getCompanyProfile } from '@/lib/companyProfile'
import { buildBalanceSheet, buildProfitLoss } from '@/lib/reports'
import { getVisibleJournalEntryIds, getVisibleJournalEntryIdsAtPoint } from '@/lib/accounting/ancestry'
import { getBranch } from '@/lib/accounting/branch'

export interface SummaryResult {
  baseCurrency: string
  totalAssets: number
  totalLiabilities: number
  totalEquity: number
  totalEquityWithRetained: number
  retainedEarnings: number
  netIncome: number
  totalRevenue: number
  cashBalance?: number
  balanced: boolean
  currencies: string[]
  entryCount: number
  eventCount: number
  asOf?: string | null
  branch: string
}

export async function buildSummary(opts: {
  branch?: string
  asOf?: string | null
}): Promise<SummaryResult> {
  const branch = opts.branch || 'main'
  const asOf = opts.asOf || null
  const profile = await getCompanyProfile()
  const baseCurrency = profile.baseCurrency || 'EUR'

  const [bs, pl] = await Promise.all([
    buildBalanceSheet({ branch, asOf, baseCurrency }),
    buildProfitLoss({ branch, asOf, baseCurrency }),
  ])

  // Count visible journal entries using the exact same visibility the journal feed uses.
  let visibleEntryIds: string[] = []
  if (asOf) {
    visibleEntryIds = await getVisibleJournalEntryIdsAtPoint(asOf)
  } else {
    const br = await getBranch(branch)
    visibleEntryIds = await getVisibleJournalEntryIds(br?.headEventId)
  }
  const entryCount = await prisma.journalEntry.count({
    where: { id: { in: visibleEntryIds } },
  })
  const eventCount = await prisma.event.count()

  const cashAccount = bs.assets.items.find((a) => a.code === '1000' || a.code === '1100')
  const currencies = Array.from(
    new Set(bs.assets.items.concat(bs.liabilities.items, bs.equity.items).map((a) => a.currency)),
  ).sort()

  return {
    baseCurrency,
    totalAssets: bs.assets.total,
    totalLiabilities: bs.liabilities.total,
    totalEquity: bs.equity.total,
    totalEquityWithRetained: bs.totalEquityWithRetained,
    retainedEarnings: bs.retainedEarnings,
    netIncome: pl.netIncome,
    totalRevenue: pl.revenue.total,
    cashBalance: cashAccount ? cashAccount.balance : undefined,
    balanced: bs.balanced,
    currencies,
    entryCount,
    eventCount,
    asOf,
    branch,
  }
}
