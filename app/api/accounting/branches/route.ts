import { NextResponse } from 'next/server'
import { createBranch, listBranches, ensureMainBranch } from '@/lib/accounting/branch'
import { requireUser } from '@/lib/authz'

export async function GET() {
  if (!await requireUser()) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  await ensureMainBranch()
  const branches = await listBranches()
  return NextResponse.json(branches)
}

export async function POST(request: Request) {
  if (!await requireUser(['ADMIN', 'ACCOUNTANT'])) return NextResponse.json({ error: 'Accountant access required' }, { status: 403 })
  try {
    const body = (await request.json()) as { name?: string; fromEventId?: string; description?: string }
    const { name, fromEventId, description } = body

    if (!name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    }

    const branch = await createBranch(name, fromEventId, description)
    return NextResponse.json(branch, { status: 201 })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg || 'Failed to create branch' }, { status: 400 })
  }
}
