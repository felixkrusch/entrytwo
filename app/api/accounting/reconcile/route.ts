import { NextResponse } from 'next/server'
import { reconcileAccount } from '@/lib/accounting/reconcile'
import { requireUser } from '@/lib/authz'

export async function POST(request: Request) {
  if (!await requireUser(['ADMIN', 'ACCOUNTANT'])) return NextResponse.json({ error: 'Accountant access required' }, { status: 403 })
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
