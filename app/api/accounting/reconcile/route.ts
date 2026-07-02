import { NextResponse } from 'next/server'
import { reconcileAccount } from '@/lib/accounting/reconcile'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { accountCode, from, to, autoApplyHighConfidence } = body

    const result = await reconcileAccount({
      accountCode,
      from,
      to,
      autoApplyHighConfidence: autoApplyHighConfidence !== false,
    })

    return NextResponse.json(result)
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Reconciliation failed' }, { status: 400 })
  }
}
