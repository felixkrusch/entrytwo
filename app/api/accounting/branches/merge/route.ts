import { NextResponse } from 'next/server'
import { mergeBranch } from '@/lib/accounting/merge'
import { ensureMainBranch } from '@/lib/accounting/branch'

export async function POST(request: Request) {
  try {
    await ensureMainBranch()
    const body = await request.json()
    const { source, target = 'main' } = body

    if (!source) {
      return NextResponse.json({ error: 'source branch name is required' }, { status: 400 })
    }

    const result = await mergeBranch(source, target)
    return NextResponse.json({ ok: true, ...result })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Merge failed' }, { status: 400 })
  }
}
