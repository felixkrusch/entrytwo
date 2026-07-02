import { NextResponse } from 'next/server'
import { blameAccount } from '@/lib/accounting/blame'

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const accountCode = url.searchParams.get('accountCode') || url.searchParams.get('account') || '1100'
    const asOf = url.searchParams.get('asOf') || url.searchParams.get('asof') || undefined
    const result = await blameAccount(accountCode, asOf)
    return NextResponse.json(result)
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Blame failed' }, { status: 400 })
  }
}
