import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getTaxDirection } from '@/lib/taxDirection'
import { getVisibleJournalEntryIds, getVisibleJournalEntryIdsAtPoint } from '@/lib/accounting/ancestry'

interface ReportItem {
  code: string
  name: string
  amount: number
  nativeAmount: number
  currency: string
  baseCurrency: string
  feedSourced: boolean
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')
    const branch = url.searchParams.get('branch') || 'main'
    const asOf = url.searchParams.get('asOf') || url.searchParams.get('asof')

    const branchParam = branch || 'main'
    let visibleEntryIds: string[] = []
    if (asOf) {
      visibleEntryIds = await getVisibleJournalEntryIdsAtPoint(asOf)
    } else {
      const br = await prisma.accountingBranch.findUnique({ where: { name: branchParam } })
      visibleEntryIds = await getVisibleJournalEntryIds(br?.headEventId)
    }

    const lineWhere: any = {}
    if (visibleEntryIds.length > 0) {
      lineWhere.journalEntryId = { in: visibleEntryIds }
    } else {
      lineWhere.id = 'no-visible'
    }
    if (from || to) {
      lineWhere.journalEntry = lineWhere.journalEntry || {}
      lineWhere.journalEntry.date = lineWhere.journalEntry.date || {}
      if (from) lineWhere.journalEntry.date.gte = new Date(from)
      if (to) lineWhere.journalEntry.date.lte = new Date(to)
    }

    const accounts = await prisma.account.findMany({
      include: {
        journalLines: {
          where: lineWhere,
          include: {
            journalEntry: { select: { date: true } },
            taxRate: {
              select: { id: true, jurisdiction: true, name: true, rate: true, taxType: true }
            }
          }
        }
      }
    })

    let totalRevenue = 0
    let totalExpenses = 0
    let totalInputTax = 0
    let totalOutputTax = 0

    const revenueLines: ReportItem[] = []
    const expenseLines: ReportItem[] = []

    const byCurrency: Record<string, {
      revenueNative: number
      expensesNative: number
      revenueBase: number
      expensesBase: number
      netNative: number
      netBase: number
    }> = {}

    const toBase = (line: { currency?: string | null; fxRateToBase?: unknown }, amount: number): number => {
      const cur = (line.currency || 'EUR').toUpperCase()
      if (cur === 'EUR') return amount
      const rate = line.fxRateToBase != null ? Number(line.fxRateToBase) : null
      return rate != null && isFinite(rate) ? amount * rate : amount
    }

    accounts.forEach(account => {
      account.journalLines.forEach((line) => {
        const debit = Number(line.debit)
        const credit = Number(line.credit)
        const baseDebit = toBase(line, debit)
        const baseCredit = toBase(line, credit)

        const cur = (line.currency || 'EUR').toUpperCase()
        if (!byCurrency[cur]) {
          byCurrency[cur] = { revenueNative: 0, expensesNative: 0, revenueBase: 0, expensesBase: 0, netNative: 0, netBase: 0 }
        }

        if (account.type === 'REVENUE') {
          totalRevenue += baseCredit - baseDebit
          byCurrency[cur].revenueNative += (credit - debit)
          byCurrency[cur].revenueBase += (baseCredit - baseDebit)

          if (line.taxRate) {
            const isInput = getTaxDirection(account.type, { debit: line.debit, credit: line.credit }, line.taxIsInput as boolean | null | undefined)
            if (!isInput) {
              const taxAmt = (baseCredit - baseDebit) * Number(line.taxRate.rate)
              totalOutputTax += taxAmt
            }
          }
        } else if (account.type === 'EXPENSE') {
          totalExpenses += baseDebit - baseCredit
          byCurrency[cur].expensesNative += (debit - credit)
          byCurrency[cur].expensesBase += (baseDebit - baseCredit)

          if (line.taxRate) {
            const isInput = getTaxDirection(account.type, { debit: line.debit, credit: line.credit }, line.taxIsInput as boolean | null | undefined)
            if (isInput) {
              const taxAmt = (baseDebit - baseCredit) * Number(line.taxRate.rate)
              totalInputTax += taxAmt
            }
          }
        }
      })

      let baseBalance = 0
      let nativeBalance = 0
      const currencies = new Set<string>()

      account.journalLines.forEach((line) => {
        const d = Number(line.debit)
        const c = Number(line.credit)
        const baseD = toBase(line, d)
        const baseC = toBase(line, c)
        const cur = (line.currency || 'EUR').toUpperCase()
        currencies.add(cur)

        if (account.type === 'REVENUE') {
          baseBalance += baseC - baseD
          nativeBalance += c - d
        } else if (account.type === 'EXPENSE') {
          baseBalance += baseD - baseC
          nativeBalance += d - c
        }
      })

      const cleanBase = parseFloat(baseBalance.toFixed(2))
      const cleanNative = parseFloat(nativeBalance.toFixed(2))
      const displayCurrency = Array.from(currencies).find(c => c !== 'EUR') || Array.from(currencies)[0] || 'EUR'
      const hasFeed = account.journalLines.some(l => (l.fxSource || '').toUpperCase().startsWith('BANK_FEED'))

      if ((account.type === 'REVENUE' || account.type === 'EXPENSE') && cleanBase !== 0) {
        const target = account.type === 'REVENUE' ? revenueLines : expenseLines
        target.push({
          code: account.code,
          name: account.name,
          amount: cleanBase,
          nativeAmount: cleanNative,
          currency: displayCurrency,
          baseCurrency: 'EUR',
          feedSourced: hasFeed,
        })
      }
    })

    Object.keys(byCurrency).forEach(cur => {
      byCurrency[cur].netNative = parseFloat((byCurrency[cur].revenueNative - byCurrency[cur].expensesNative).toFixed(2))
      byCurrency[cur].netBase = parseFloat((byCurrency[cur].revenueBase - byCurrency[cur].expensesBase).toFixed(2))
    })

    const netIncome = parseFloat((totalRevenue - totalExpenses).toFixed(2))

    return NextResponse.json({
      revenue: { total: parseFloat(totalRevenue.toFixed(2)), items: revenueLines.sort((a, b) => a.code.localeCompare(b.code)) },
      expenses: { total: parseFloat(totalExpenses.toFixed(2)), items: expenseLines.sort((a, b) => a.code.localeCompare(b.code)) },
      netIncome,
      taxSummary: {
        inputTax: parseFloat(totalInputTax.toFixed(2)),
        outputTax: parseFloat(totalOutputTax.toFixed(2)),
        netTax: parseFloat((totalOutputTax - totalInputTax).toFixed(2))
      },
      byCurrency: Object.fromEntries(Object.entries(byCurrency).map(([cur, v]) => [cur, v]))
    })
  } catch (error) {
    console.error('P&L error:', error)
    return NextResponse.json({ error: 'Failed to generate P&L' }, { status: 500 })
  }
}