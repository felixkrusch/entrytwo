import { NextResponse } from 'next/server'
import { ensureMainBranch } from '@/lib/accounting/branch'

export async function POST() {
  try {
    const main = await ensureMainBranch()
    return NextResponse.json({ ok: true, branch: main })
  } catch (error) {
    console.error('ensure-main error', error)
    return NextResponse.json({ error: 'Failed to ensure main branch' }, { status: 500 })
  }
}
