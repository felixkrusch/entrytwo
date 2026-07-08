import { NextResponse } from 'next/server'
import { reconcileAccount } from '@/lib/accounting/reconcile'

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { accountCode?: string; from?: string; to?: string; autoApplyHighConfidence?: boolean }
    const { accountCode, from, to, autoApplyHighConfidence } = body

    const result = await reconcileAccount({
      accountCode,
      from,
      to,
      autoApplyHighConfidence: autoApplyHighConfidence !== false,
    })

    return NextResponse.json(result)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg || 'Reconciliation failed' }, { status: 400 })
  }
}
