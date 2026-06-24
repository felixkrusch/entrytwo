import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const accounts = await prisma.account.findMany({
      include: {
        journalLines: true
      }
    })

    const report = accounts.map(account => {
      const balance = account.journalLines.reduce((sum, line) => {
        if (['ASSET', 'EXPENSE'].includes(account.type)) {
          return sum + Number(line.debit) - Number(line.credit)
        } else {
          return sum + Number(line.credit) - Number(line.debit)
        }
      }, 0)

      // Multi-currency awareness: pick first non-EUR or default EUR
      const currencies = Array.from(new Set(account.journalLines.map(l => l.currency || 'EUR')))
      const displayCurrency = currencies.find(c => c !== 'EUR') || currencies[0] || 'EUR'

      return {
        code: account.code,
        name: account.name,
        type: account.type,
        balance: parseFloat(balance.toFixed(2)),
        currency: displayCurrency
      }
    })

    return NextResponse.json(report)
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to generate balance sheet' },
      { status: 500 }
    )
  }
}
