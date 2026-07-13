import { NextResponse } from 'next/server'
import { getCompanyProfile } from '@/lib/companyProfile'
import { buildCashFlow } from '@/lib/reports'
import { requireUser } from '@/lib/authz'

export async function GET(request: Request) {
  if (!await requireUser()) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  try {
    const url = new URL(request.url)
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')
    const branch = url.searchParams.get('branch') || 'main'
    const asOf = url.searchParams.get('asOf') || url.searchParams.get('asof')

    const profile = await getCompanyProfile()
    const baseCurrency = profile.baseCurrency || 'EUR'

    const data = await buildCashFlow({ from, to, branch, asOf, baseCurrency })
    return NextResponse.json(data)
  } catch (error) {
    console.error('Cash flow error:', error)
    return NextResponse.json({ error: 'Failed to generate cash flow statement' }, { status: 500 })
  }
}
