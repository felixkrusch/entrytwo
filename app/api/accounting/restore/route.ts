import { NextResponse } from 'next/server'
import { restoreBranchToEvent } from '@/lib/accounting/restore'
import { ensureMainBranch } from '@/lib/accounting/branch'

export async function POST(request: Request) {
  try {
    await ensureMainBranch()
    const body = await request.json()
    const { branch = 'main', toEventId } = body

    if (!toEventId) {
      return NextResponse.json({ error: 'toEventId is required' }, { status: 400 })
    }

    const result = await restoreBranchToEvent(branch, toEventId)
    return NextResponse.json({ ok: true, ...result })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg || 'Restore failed' }, { status: 400 })
  }
}
