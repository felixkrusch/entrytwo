import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getTaxDirection } from '@/lib/taxDirection'

export async function GET() {
  try {
    const accounts = await prisma.account.findMany({
      include: {
        journalLines: {
          include: {
            taxRate: {
              select: { id: true, jurisdiction: true, name: true, rate: true, taxType: true }
            }
          }
        }
      }
    })

    let totalRevenue = 0
    let totalExpenses = 0
    let totalInputTax = 0   // Vorsteuer recovered
    let totalOutputTax = 0  // Umsatzsteuer collected

    interface ReportItem { code: string; name: string; amount: number; nativeAmount: number; currency: string; baseCurrency: string; feedSourced: boolean }
    const revenueLines: ReportItem[] = []
    const expenseLines: ReportItem[] = []

    // Richer per-currency breakdown (Phase 0 multi-currency enhancement)
    // key: currency code (e.g. "USD", "EUR")
    const byCurrency: Record<string, {
      revenueNative: number
      expensesNative: number
      revenueBase: number
      expensesBase: number
      netNative: number
      netBase: number
    }> = {}

    // Helper: convert a line amount to base currency (EUR) using fxRateToBase if present.
    // fxRateToBase means: baseAmount = foreignAmount * fxRateToBase
    const toBase = (line: { currency?: string | null; fxRateToBase?: unknown }, amount: number): number => {
      const cur = (line.currency || 'EUR').toUpperCase()
      if (cur === 'EUR') return amount
      const rate = line.fxRateToBase != null ? Number(line.fxRateToBase) : null
      return rate != null && isFinite(rate) ? amount * rate : amount // fallback: use raw if no rate (will be visible in UI)
    }

    accounts.forEach(account => {
      account.journalLines.forEach((line) => {
        const debit = Number(line.debit)
        const credit = Number(line.credit)

        // Use base-currency equivalents for totals
        const baseDebit = toBase(line, debit)
        const baseCredit = toBase(line, credit)

        const cur = (line.currency || 'EUR').toUpperCase()
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
        const bc = byCurrency[cur]

        if (account.type === 'REVENUE') {
          totalRevenue += baseCredit - baseDebit
          bc.revenueNative += (credit - debit)
          bc.revenueBase += (baseCredit - baseDebit)

          if (line.taxRate) {
            const isInput = getTaxDirection(account.type, line, (line as any).taxIsInput)
            if (!isInput) {
              const taxAmt = (baseCredit - baseDebit) * Number(line.taxRate.rate)
              totalOutputTax += taxAmt
            }
          }
        } else if (account.type === 'EXPENSE') {
          totalExpenses += baseDebit - baseCredit
          bc.expensesNative += (debit - credit)
          bc.expensesBase += (baseDebit - baseCredit)

          if (line.taxRate) {
            const isInput = getTaxDirection(account.type, line, (line as any).taxIsInput)
            if (isInput) {
              const taxAmt = (baseDebit - baseCredit) * Number(line.taxRate.rate)
              totalInputTax += taxAmt
            }
          }
        }
      })

      // Per-account balance in base currency + native (original currency) sum for transparency
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

        const nativeD = cur === 'EUR' ? d : d
        const nativeC = cur === 'EUR' ? c : c

        if (account.type === 'REVENUE') {
          baseBalance += baseC - baseD
          nativeBalance += nativeC - nativeD
        } else if (account.type === 'EXPENSE') {
          baseBalance += baseD - baseC
          nativeBalance += nativeD - nativeC
        }
      })

      const cleanBase = parseFloat(baseBalance.toFixed(2))
      const cleanNative = parseFloat(nativeBalance.toFixed(2))
      const displayCurrency = Array.from(currencies).find(c => c !== 'EUR') || Array.from(currencies)[0] || 'EUR'

      // Detect if any line in this account came from an authoritative bank/card feed
      const hasFeed = account.journalLines.some(l =>
        (l.fxSource || '').toUpperCase().startsWith('BANK_FEED')
      )

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

    // Finalize per-currency nets
    Object.keys(byCurrency).forEach(cur => {
      const bc = byCurrency[cur]
      bc.netNative = parseFloat((bc.revenueNative - bc.expensesNative).toFixed(2))
      bc.netBase = parseFloat((bc.revenueBase - bc.expensesBase).toFixed(2))
    })

    const netIncome = parseFloat((totalRevenue - totalExpenses).toFixed(2))

    return NextResponse.json({
      revenue: {
        total: parseFloat(totalRevenue.toFixed(2)),
        items: revenueLines.sort((a, b) => a.code.localeCompare(b.code))
      },
      expenses: {
        total: parseFloat(totalExpenses.toFixed(2)),
        items: expenseLines.sort((a, b) => a.code.localeCompare(b.code))
      },
      netIncome,
      taxSummary: {
        inputTax: parseFloat(totalInputTax.toFixed(2)),
        outputTax: parseFloat(totalOutputTax.toFixed(2)),
        netTax: parseFloat((totalOutputTax - totalInputTax).toFixed(2))
      },
      // Rich multi-currency view
      byCurrency: Object.fromEntries(
        Object.entries(byCurrency).map(([cur, v]) => [cur, v])
      )
    })
  } catch (error) {
    console.error('P&L error:', error)
    return NextResponse.json({ error: 'Failed to generate P&L' }, { status: 500 })
  }
}
