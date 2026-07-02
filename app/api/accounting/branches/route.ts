import { NextResponse } from 'next/server'
import { createBranch, listBranches, getBranch, ensureMainBranch } from '@/lib/accounting/branch'

export async function GET() {
  await ensureMainBranch()
  const branches = await listBranches()
  return NextResponse.json(branches)
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { name, fromEventId, description } = body

    if (!name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    }

    const branch = await createBranch(name, fromEventId, description)
    return NextResponse.json(branch, { status: 201 })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Failed to create branch' }, { status: 400 })
  }
}
