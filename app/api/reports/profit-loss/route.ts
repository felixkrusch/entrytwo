import { NextResponse } from 'next/server'
import { getCompanyProfile } from '@/lib/companyProfile'
import { buildProfitLoss } from '@/lib/reports'
import { requireUser } from '@/lib/authz'

export async function GET(request: Request) {
  if (!await requireUser()) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  try {
    const url = new URL(request.url)
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')
    const branch = url.searchParams.get('branch') || 'main'
    const asOf = url.searchParams.get('asOf') || url.searchParams.get('asof')
    const compareFrom = url.searchParams.get('compareFrom')
    const compareTo = url.searchParams.get('compareTo')

    const profile = await getCompanyProfile()
    const baseCurrency = profile.baseCurrency || 'EUR'

    const data = await buildProfitLoss({
      from,
      to,
      branch,
      asOf,
      baseCurrency,
      compareFrom,
      compareTo,
    })

    // comparison totals
    if (compareFrom || compareTo) {
      const prior = await buildProfitLoss({
        from: compareFrom,
        to: compareTo,
        branch,
        asOf,
        baseCurrency,
      })
      data.comparison = {
        netIncomePrior: prior.netIncome,
        revenuePrior: prior.revenue.total,
        expensePrior: prior.expenses.total,
      }
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('P&L error:', error)
    return NextResponse.json({ error: 'Failed to generate P&L' }, { status: 500 })
  }
}
