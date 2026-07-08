import { NextResponse } from 'next/server'
import { generateReconciliationReport } from '@/lib/accounting/reconciliation-report'
import { reconcileAccount } from '@/lib/accounting/reconcile'

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { accountCode?: string; from?: string; to?: string }
    const { accountCode = '1100', from, to } = body

    const recon = await reconcileAccount({ accountCode, from, to, autoApplyHighConfidence: true })

    // Always produce a classical report as the output of AI reconciliation (Git model)
    const report = await generateReconciliationReport(accountCode, {
      ledgerBalance: recon.ledgerBalance,
      differences: recon.differences || [],
      createdEntryIds: recon.createdEntryIds || [],
      reportSummary: recon.reportSummary || '',
    })

    return NextResponse.json({
      ...recon,
      report,
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg || 'Failed to generate reconciliation report' }, { status: 400 })
  }
}
