// lib/reports.ts
// Shared server-side report computation for Balance Sheet, Profit & Loss, and Cash Flow.
// All monetary values are expressed in the company base currency (from Settings) unless
// explicitly labelled as "native" (the account's dominant original currency).
//
// This module is the single source of truth so the API routes and any future UI stay
// consistent. It reuses the Git Model ancestry visibility helpers.

import { prisma } from '@/lib/prisma'
import { getVisibleJournalEntryIds, getVisibleJournalEntryIdsAtPoint } from '@/lib/accounting/ancestry'
import { getTaxDirection } from '@/lib/taxDirection'

export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE'

export interface ReportAccount {
  code: string
  name: string
  type: AccountType
  balance: number // base-currency balance (signed: assets/expenses normal-debit, others normal-credit)
  nativeBalance: number // sum in the dominant original currency (unconverted)
  currency: string // dominant original currency (== baseCurrency when account is in base)
  baseCurrency: string
  group: string // 'Current' | 'Fixed' | 'Long-term' | 'Equity' | 'Other'
}

export interface ReportItem {
  code: string
  name: string
  amount: number
  nativeAmount: number
  currency: string
  baseCurrency: string
  feedSourced: boolean
  priorAmount?: number
}

export interface TaxSummary {
  inputTax: number
  outputTax: number
  netTax: number
}

export interface ByCurrencyEntry {
  revenueNative: number
  expensesNative: number
  revenueBase: number
  expensesBase: number
  netNative: number
  netBase: number
}

export interface Comparison {
  netIncomePrior?: number
  revenuePrior?: number
  expensePrior?: number
  assetsPrior?: number
  liabilitiesPrior?: number
  equityPrior?: number
}

// ---------------------------------------------------------------------------
// Account classification helpers (convention-based grouping)
// ---------------------------------------------------------------------------

export function classifyGroup(type: string, code: string): string {
  const n = parseInt(code, 10)
  if (type === 'ASSET') {
    if (!isNaN(n) && n >= 1000 && n < 1500) return 'Current'
    if (!isNaN(n) && n >= 1500 && n < 2000) return 'Fixed'
    return 'Other'
  }
  if (type === 'LIABILITY') {
    if (!isNaN(n) && n >= 2000 && n < 2500) return 'Current'
    if (!isNaN(n) && n >= 2500 && n < 3000) return 'Long-term'
    return 'Other'
  }
  if (type === 'EQUITY') return 'Equity'
  return 'Other'
}

export function isCashAccount(type: string, code: string): boolean {
  const n = parseInt(code, 10)
  return type === 'ASSET' && !isNaN(n) && n >= 1000 && n < 1100
}

// ---------------------------------------------------------------------------
// Scope / visibility
// ---------------------------------------------------------------------------

interface Scope {
  lineWhere: Record<string, unknown>
  restrict: boolean
}

async function getScope(
  from?: string | null,
  to?: string | null,
  branch = 'main',
  asOf?: string | null,
): Promise<Scope> {
  let visibleEntryIds: string[] = []
  let restrict = false
  if (asOf) {
    visibleEntryIds = await getVisibleJournalEntryIdsAtPoint(asOf)
    restrict = true
  } else {
    const br = await prisma.accountingBranch.findUnique({ where: { name: branch } })
    visibleEntryIds = await getVisibleJournalEntryIds(br?.headEventId)
    restrict = visibleEntryIds.length > 0
  }

  const lineWhere: Record<string, unknown> = {}
  if (restrict) {
    if (visibleEntryIds.length > 0) lineWhere.journalEntryId = { in: visibleEntryIds }
    else lineWhere.id = 'no-visible'
  }

  if (from || to) {
    const date: Record<string, Date> = {}
    if (from) date.gte = new Date(from)
    if (to) date.lte = new Date(to)
    lineWhere.journalEntry = { date }
  }

  return { lineWhere, restrict }
}

function toBase(line: { currency?: string | null; fxRateToBase?: unknown }, amount: number, baseCurrency: string): number {
  const cur = (line.currency || baseCurrency).toUpperCase()
  if (cur === baseCurrency.toUpperCase()) return amount
  const rate = line.fxRateToBase != null ? Number(line.fxRateToBase) : null
  if (rate == null || !isFinite(rate) || rate <= 0) {
    throw new Error(`Cannot report foreign-currency line without a valid FX rate (${cur})`)
  }
  return amount * rate
}

function baseDelta(type: string, baseDebit: number, baseCredit: number): number {
  if (type === 'ASSET' || type === 'EXPENSE') return baseDebit - baseCredit
  return baseCredit - baseDebit
}

// ---------------------------------------------------------------------------
// Core balance computation for a set of accounts under a given scope
// ---------------------------------------------------------------------------

async function computeAccountBalances(scope: Scope, baseCurrency: string): Promise<ReportAccount[]> {
  const accounts = await prisma.account.findMany({
    include: { journalLines: { where: scope.lineWhere } },
  })

  const baseU = baseCurrency.toUpperCase()

  return accounts.map((account) => {
    let baseBal = 0
    let nativeBal = 0
    const currencies = new Set<string>()

    account.journalLines.forEach((line) => {
      const d = Number(line.debit)
      const c = Number(line.credit)
      const baseD = toBase(line, d, baseCurrency)
      const baseC = toBase(line, c, baseCurrency)
      const cur = (line.currency || baseCurrency).toUpperCase()
      currencies.add(cur)

      baseBal += baseDelta(account.type, baseD, baseC)
      nativeBal += baseDelta(account.type, d, c)
    })

    // Only surface a foreign "native" currency for:
    // - P/L (revenue/expense) items, where you may want to see original foreign spend/revenue, and
    // - ASSET accounts (for the "by currency" composition of what you hold).
    // Liabilities and Equity are always shown in base currency (even if some lines were foreign).
    // We suppress the foreign display if the net native amount in foreign currency is ~0
    // (e.g. a foreign line and its full reversal on the account).
    const isPl = account.type === 'REVENUE' || account.type === 'EXPENSE'
    const allowForeignNative = isPl || account.type === 'ASSET'
    let displayCurrency = baseCurrency
    let shownNative = parseFloat(baseBal.toFixed(2))
    if (allowForeignNative) {
      const foreignSeen = Array.from(currencies).find((c) => c !== baseU)
      if (foreignSeen && Math.abs(nativeBal) > 0.005) {
        displayCurrency = foreignSeen
        shownNative = parseFloat(nativeBal.toFixed(2))
      }
    }

    return {
      code: account.code,
      name: account.name,
      type: account.type as AccountType,
      balance: parseFloat(baseBal.toFixed(2)),
      nativeBalance: shownNative,
      currency: displayCurrency,
      baseCurrency,
      group: classifyGroup(account.type, account.code),
    }
  })
}

// ---------------------------------------------------------------------------
// Profit & Loss
// ---------------------------------------------------------------------------

interface PLInner {
  revenueItems: ReportItem[]
  expenseItems: ReportItem[]
  revenueTotal: number
  expenseTotal: number
  netIncome: number
  taxSummary: TaxSummary
  byCurrency: Record<string, ByCurrencyEntry>
}

async function computePLInner(scope: Scope, baseCurrency: string): Promise<PLInner> {
  const accounts = await prisma.account.findMany({
    include: {
      journalLines: {
        where: scope.lineWhere,
        include: {
          taxRate: { select: { id: true, jurisdiction: true, name: true, rate: true, taxType: true } },
        },
      },
    },
  })

  let totalRevenue = 0
  let totalExpenses = 0
  let totalInputTax = 0
  let totalOutputTax = 0

  const revenueLines: ReportItem[] = []
  const expenseLines: ReportItem[] = []

  const byCurrency: Record<string, ByCurrencyEntry> = {}

  accounts.forEach((account) => {
    let baseBalance = 0
    let nativeBalance = 0
    const currencies = new Set<string>()

    account.journalLines.forEach((line) => {
      const debit = Number(line.debit)
      const credit = Number(line.credit)
      const baseDebit = toBase(line, debit, baseCurrency)
      const baseCredit = toBase(line, credit, baseCurrency)
      const cur = (line.currency || baseCurrency).toUpperCase()
      if (!byCurrency[cur]) {
        byCurrency[cur] = {
          revenueNative: 0,
          expensesNative: 0,
          revenueBase: 0,
          expensesBase: 0,
          netNative: 0,
          netBase: 0,
        }
      }

      if (account.type === 'REVENUE') {
        totalRevenue += baseCredit - baseDebit
        byCurrency[cur].revenueNative += credit - debit
        byCurrency[cur].revenueBase += baseCredit - baseDebit
        baseBalance += baseCredit - baseDebit
        nativeBalance += credit - debit
        if (line.taxRate) {
          const isInput = getTaxDirection(
            account.type,
            { debit: line.debit, credit: line.credit },
            line.taxIsInput as boolean | null | undefined,
          )
          if (!isInput) totalOutputTax += (baseCredit - baseDebit) * Number(line.taxRate.rate)
        }
      } else if (account.type === 'EXPENSE') {
        totalExpenses += baseDebit - baseCredit
        byCurrency[cur].expensesNative += debit - credit
        byCurrency[cur].expensesBase += baseDebit - baseCredit
        baseBalance += baseDebit - baseCredit
        nativeBalance += debit - credit
        if (line.taxRate) {
          const isInput = getTaxDirection(
            account.type,
            { debit: line.debit, credit: line.credit },
            line.taxIsInput as boolean | null | undefined,
          )
          if (isInput) totalInputTax += (baseDebit - baseCredit) * Number(line.taxRate.rate)
        }
      }
      currencies.add(cur)
    })

    const cleanBase = parseFloat(baseBalance.toFixed(2))
    const cleanNative = parseFloat(nativeBalance.toFixed(2))
    const baseU = baseCurrency.toUpperCase()
    const foreign = Array.from(currencies).find((c) => c !== baseU)
    // Only advertise a foreign native amount for P/L items if there is a meaningful remaining native balance.
    // Fully reversed foreign activity should not produce "USD ~0.00" noise.
    const useForeign = !!(foreign && Math.abs(cleanNative) > 0.005)
    const displayCurrency = useForeign ? foreign : baseCurrency
    const shownNative = useForeign ? cleanNative : cleanBase
    const hasFeed = account.journalLines.some((l) =>
      ((l as { fxSource?: string }).fxSource || '').toUpperCase().startsWith('BANK_FEED'),
    )

    if ((account.type === 'REVENUE' || account.type === 'EXPENSE') && cleanBase !== 0) {
      const item: ReportItem = {
        code: account.code,
        name: account.name,
        amount: cleanBase,
        nativeAmount: shownNative,
        currency: displayCurrency,
        baseCurrency,
        feedSourced: hasFeed,
      }
      if (account.type === 'REVENUE') revenueLines.push(item)
      else expenseLines.push(item)
    }
  })

  Object.keys(byCurrency).forEach((cur) => {
    byCurrency[cur].netNative = parseFloat(
      (byCurrency[cur].revenueNative - byCurrency[cur].expensesNative).toFixed(2),
    )
    byCurrency[cur].netBase = parseFloat(
      (byCurrency[cur].revenueBase - byCurrency[cur].expensesBase).toFixed(2),
    )
  })

  revenueLines.sort((a, b) => a.code.localeCompare(b.code))
  expenseLines.sort((a, b) => a.code.localeCompare(b.code))

  return {
    revenueItems: revenueLines,
    expenseItems: expenseLines,
    revenueTotal: parseFloat(totalRevenue.toFixed(2)),
    expenseTotal: parseFloat(totalExpenses.toFixed(2)),
    netIncome: parseFloat((totalRevenue - totalExpenses).toFixed(2)),
    taxSummary: {
      inputTax: parseFloat(totalInputTax.toFixed(2)),
      outputTax: parseFloat(totalOutputTax.toFixed(2)),
      netTax: parseFloat((totalOutputTax - totalInputTax).toFixed(2)),
    },
    byCurrency,
  }
}

export interface ProfitLossResult {
  baseCurrency: string
  revenue: { total: number; items: ReportItem[] }
  expenses: { total: number; items: ReportItem[] }
  netIncome: number
  taxSummary: TaxSummary
  byCurrency: Record<string, ByCurrencyEntry>
  comparison?: Comparison
}

export async function buildProfitLoss(opts: {
  from?: string | null
  to?: string | null
  branch?: string
  asOf?: string | null
  baseCurrency: string
  compareFrom?: string | null
  compareTo?: string | null
}): Promise<ProfitLossResult> {
  const { from, to, branch = 'main', asOf, baseCurrency, compareFrom, compareTo } = opts
  const scope = await getScope(from, to, branch, asOf)
  const current = await computePLInner(scope, baseCurrency)

  if (compareFrom || compareTo) {
    const priorScope = await getScope(compareFrom, compareTo, branch, asOf)
    const prior = await computePLInner(priorScope, baseCurrency)
    const priorRevenue = new Map(prior.revenueItems.map((i) => [i.code, i.amount]))
    const priorExpense = new Map(prior.expenseItems.map((i) => [i.code, i.amount]))
    current.revenueItems.forEach((i) => (i.priorAmount = priorRevenue.get(i.code) ?? 0))
    current.expenseItems.forEach((i) => (i.priorAmount = priorExpense.get(i.code) ?? 0))
  }

  return {
    baseCurrency,
    revenue: { total: current.revenueTotal, items: current.revenueItems },
    expenses: { total: current.expenseTotal, items: current.expenseItems },
    netIncome: current.netIncome,
    taxSummary: current.taxSummary,
    byCurrency: current.byCurrency,
    comparison:
      compareFrom || compareTo
        ? {
            netIncomePrior: current.netIncome,
            revenuePrior: 0,
            expensePrior: 0,
          }
        : undefined,
  }
}

// ---------------------------------------------------------------------------
// Balance Sheet
// ---------------------------------------------------------------------------

export interface BalanceSheetSection {
  label: string
  total: number
  items: ReportAccount[]
}

export interface BalanceSheetResult {
  baseCurrency: string
  from?: string | null
  to?: string | null
  asOf?: string | null
  assets: BalanceSheetSection
  liabilities: BalanceSheetSection
  equity: BalanceSheetSection // real equity accounts only
  retainedEarnings: number // cumulative net income up to `to` (Retained Earnings rollup)
  totalEquityWithRetained: number
  balanced: boolean
  byCurrency: Record<string, { native: number; base: number }>
  comparison?: {
    assetsTotalPrior?: number
    liabilitiesTotalPrior?: number
    equityTotalPrior?: number
    items: Record<string, number> // code -> prior balance
  }
}

export async function buildBalanceSheet(opts: {
  from?: string | null
  to?: string | null
  branch?: string
  asOf?: string | null
  baseCurrency: string
  compareFrom?: string | null
  compareTo?: string | null
}): Promise<BalanceSheetResult> {
  const { from, to, branch = 'main', asOf, baseCurrency, compareFrom, compareTo } = opts

  const scope = await getScope(from, to, branch, asOf)
  const accounts = await computeAccountBalances(scope, baseCurrency)

  const assets = accounts.filter((a) => a.type === 'ASSET')
  const liabilities = accounts.filter((a) => a.type === 'LIABILITY')
  const equity = accounts.filter((a) => a.type === 'EQUITY')

  const assetsTotal = parseFloat(assets.reduce((s, a) => s + a.balance, 0).toFixed(2))
  const liabilitiesTotal = parseFloat(liabilities.reduce((s, a) => s + a.balance, 0).toFixed(2))
  const equityTotal = parseFloat(equity.reduce((s, a) => s + a.balance, 0).toFixed(2))

  // Retained Earnings = cumulative net income up to `to` (ignore `from`), so the
  // balance sheet always reconciles: Assets = Liabilities + Equity + Net Income.
  const rePL = await buildProfitLoss({ from: null, to, branch, asOf, baseCurrency })
  const retainedEarnings = rePL.netIncome
  const totalEquityWithRetained = parseFloat((equityTotal + retainedEarnings).toFixed(2))

  const balanced =
    parseFloat((assetsTotal - (liabilitiesTotal + totalEquityWithRetained)).toFixed(2)) === 0

  // "By currency" shows the currency composition of the ASSETS held (not a sum across
  // all account types — that would double-count because Assets = Liabilities + Equity).
  const byCurrency: Record<string, { native: number; base: number }> = {}
  accounts
    .filter((a) => a.type === 'ASSET')
    .forEach((a) => {
      if (!byCurrency[a.currency]) byCurrency[a.currency] = { native: 0, base: 0 }
      byCurrency[a.currency].base += a.balance
      byCurrency[a.currency].native += a.nativeBalance
    })
  Object.values(byCurrency).forEach((v) => {
    v.native = parseFloat(v.native.toFixed(2))
    v.base = parseFloat(v.base.toFixed(2))
  })

  const result: BalanceSheetResult = {
    baseCurrency,
    from,
    to,
    asOf,
    assets: { label: 'Assets', total: assetsTotal, items: assets },
    liabilities: { label: 'Liabilities', total: liabilitiesTotal, items: liabilities },
    equity: { label: 'Equity', total: equityTotal, items: equity },
    retainedEarnings,
    totalEquityWithRetained,
    balanced,
    byCurrency,
  }

  if (compareFrom || compareTo) {
    const priorScope = await getScope(compareFrom, compareTo, branch, asOf)
    const priorAccounts = await computeAccountBalances(priorScope, baseCurrency)
    const priorAssets = priorAccounts.filter((a) => a.type === 'ASSET')
    const priorLiab = priorAccounts.filter((a) => a.type === 'LIABILITY')
    const priorEq = priorAccounts.filter((a) => a.type === 'EQUITY')
    const priorRE = (
      await buildProfitLoss({ from: null, to: compareTo, branch, asOf, baseCurrency })
    ).netIncome
    result.comparison = {
      assetsTotalPrior: parseFloat(priorAssets.reduce((s, a) => s + a.balance, 0).toFixed(2)),
      liabilitiesTotalPrior: parseFloat(priorLiab.reduce((s, a) => s + a.balance, 0).toFixed(2)),
      equityTotalPrior: parseFloat(
        (priorEq.reduce((s, a) => s + a.balance, 0) + priorRE).toFixed(2),
      ),
      items: Object.fromEntries(priorAccounts.map((a) => [a.code, a.balance])),
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// Cash Flow Statement (indirect method)
// ---------------------------------------------------------------------------

export interface CashFlowSection {
  label: string
  total: number
  items: Array<{ code: string; name: string; delta: number }>
}

export interface CashFlowResult {
  baseCurrency: string
  from?: string | null
  to?: string | null
  operating: CashFlowSection
  investing: CashFlowSection
  financing: CashFlowSection
  netChange: number
  beginningCash: number
  endingCash: number
}

export async function buildCashFlow(opts: {
  from?: string | null
  to?: string | null
  branch?: string
  asOf?: string | null
  baseCurrency: string
}): Promise<CashFlowResult> {
  const { from, to, branch = 'main', asOf, baseCurrency } = opts

  const closingScope = await getScope(from, to, branch, asOf)
  const closing = await computeAccountBalances(closingScope, baseCurrency)

  let opening: ReportAccount[] = []
  if (from) {
    const openingScope = await getScope(null, shiftDayBefore(from), branch, asOf)
    opening = await computeAccountBalances(openingScope, baseCurrency)
  }
  const openingMap = new Map(opening.map((a) => [a.code, a.balance]))

  const deltaOf = (a: ReportAccount) => parseFloat((a.balance - (openingMap.get(a.code) ?? 0)).toFixed(2))

  const netIncome = (await buildProfitLoss({ from: from ?? null, to, branch, asOf, baseCurrency })).netIncome

  const operatingItems: Array<{ code: string; name: string; delta: number }> = []
  const investingItems: Array<{ code: string; name: string; delta: number }> = []
  const financingItems: Array<{ code: string; name: string; delta: number }> = []

  let currentAssetsExclCashDelta = 0
  let currentLiabDelta = 0
  let beginningCash = 0
  let endingCash = 0

  closing.forEach((a) => {
    const delta = deltaOf(a)
    if (isCashAccount(a.type, a.code)) {
      if (from) beginningCash += openingMap.get(a.code) ?? 0
      endingCash += a.balance
      return
    }
    if (a.type === 'ASSET' && a.group === 'Current') {
      currentAssetsExclCashDelta += delta
      operatingItems.push({ code: a.code, name: a.name, delta: -delta })
    } else if (a.type === 'LIABILITY' && a.group === 'Current') {
      currentLiabDelta += delta
      operatingItems.push({ code: a.code, name: a.name, delta })
    } else if (a.type === 'ASSET') {
      investingItems.push({ code: a.code, name: a.name, delta: -delta })
    } else if (a.type === 'LIABILITY') {
      financingItems.push({ code: a.code, name: a.name, delta })
    } else if (a.type === 'EQUITY') {
      financingItems.push({ code: a.code, name: a.name, delta })
    }
  })

  const operatingTotal = parseFloat((netIncome - currentAssetsExclCashDelta + currentLiabDelta).toFixed(2))
  if (operatingItems.length === 0) operatingItems.push({ code: 'NI', name: 'Net Income', delta: netIncome })
  const investingTotal = parseFloat(investingItems.reduce((s, i) => s + i.delta, 0).toFixed(2))
  const financingTotal = parseFloat(financingItems.reduce((s, i) => s + i.delta, 0).toFixed(2))
  const netChange = parseFloat((operatingTotal + investingTotal + financingTotal).toFixed(2))

  return {
    baseCurrency,
    from,
    to,
    operating: { label: 'Operating Activities', total: operatingTotal, items: operatingItems },
    investing: { label: 'Investing Activities', total: investingTotal, items: investingItems },
    financing: { label: 'Financing Activities', total: financingTotal, items: financingItems },
    netChange,
    beginningCash: parseFloat(beginningCash.toFixed(2)),
    endingCash: parseFloat(endingCash.toFixed(2)),
  }
}

function shiftDayBefore(date: string): string {
  const d = new Date(date)
  d.setDate(d.getDate() - 1)
  return d.toISOString().split('T')[0]
}
