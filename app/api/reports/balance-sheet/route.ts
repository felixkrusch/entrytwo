import { NextResponse } from 'next/server'
import { getCompanyProfile } from '@/lib/companyProfile'
import { buildBalanceSheet } from '@/lib/reports'

export async function GET(request: Request) {
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

    const data = await buildBalanceSheet({
      from,
      to,
      branch,
      asOf,
      baseCurrency,
      compareFrom,
      compareTo,
    })

    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: 'Failed to generate balance sheet' }, { status: 500 })
  }
}
