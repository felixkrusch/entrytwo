import { NextResponse } from 'next/server'
import { ensureMainBranch } from '@/lib/accounting/branch'
import { requireUser } from '@/lib/authz'
import { logger } from '@/lib/logger'

export async function POST() {
  if (!await requireUser(['ADMIN', 'ACCOUNTANT'])) return NextResponse.json({ error: 'Accountant access required' }, { status: 403 })
  try {
    const main = await ensureMainBranch()
    return NextResponse.json({ ok: true, branch: main })
  } catch (error) {
    logger.error('ensure-main error', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ error: 'Failed to ensure main branch' }, { status: 500 })
  }
}
