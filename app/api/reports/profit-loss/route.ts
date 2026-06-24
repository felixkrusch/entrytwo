import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const accounts = await prisma.account.findMany({
      include: {
        journalLines: {
          include: {
            taxRate: {
              select: { id: true, jurisdiction: true, name: true, rate: true, taxType: true, isInputTax: true }
            }
          }
        }
      }
    })

    let totalRevenue = 0
    let totalExpenses = 0
    let totalInputTax = 0   // Vorsteuer recovered
    let totalOutputTax = 0  // Umsatzsteuer collected

    const revenueLines: any[] = []
    const expenseLines: any[] = []

    accounts.forEach(account => {
      account.journalLines.forEach(line => {
        const debit = Number(line.debit)
        const credit = Number(line.credit)

        if (account.type === 'REVENUE') {
          totalRevenue += credit - debit
          if (line.taxRate && !line.taxRate.isInputTax) {
            const taxAmt = (credit - debit) * Number(line.taxRate.rate)
            totalOutputTax += taxAmt
          }
        } else if (account.type === 'EXPENSE') {
          totalExpenses += debit - credit
          if (line.taxRate && line.taxRate.isInputTax) {
            const taxAmt = (debit - credit) * Number(line.taxRate.rate)
            totalInputTax += taxAmt
          }
        }
      })

      const balance = account.journalLines.reduce((sum, line) => {
        if (account.type === 'REVENUE') {
          return sum + Number(line.credit) - Number(line.debit)
        } else if (account.type === 'EXPENSE') {
          return sum + Number(line.debit) - Number(line.credit)
        }
        return sum
      }, 0)

      const cleanBalance = parseFloat(balance.toFixed(2))

      // Multi-currency: pick first non-EUR or default
      const currencies = Array.from(new Set(account.journalLines.map(l => l.currency || 'EUR')))
      const displayCurrency = currencies.find(c => c !== 'EUR') || currencies[0] || 'EUR'

      if (account.type === 'REVENUE' && cleanBalance !== 0) {
        revenueLines.push({ code: account.code, name: account.name, amount: cleanBalance, currency: displayCurrency })
      } else if (account.type === 'EXPENSE' && cleanBalance !== 0) {
        expenseLines.push({ code: account.code, name: account.name, amount: cleanBalance, currency: displayCurrency })
      }
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
      }
    })
  } catch (error) {
    console.error('P&L error:', error)
    return NextResponse.json({ error: 'Failed to generate P&L' }, { status: 500 })
  }
}
