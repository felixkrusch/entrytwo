import { NextResponse } from 'next/server'
import { createTag, listTags } from '@/lib/accounting/tag'
import { requireUser } from '@/lib/authz'

export async function GET(request: Request) {
  if (!await requireUser()) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  try {
    const url = new URL(request.url)
    const branch = url.searchParams.get('branch') || undefined
    const tags = await listTags(branch)
    return NextResponse.json(tags)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg || 'Failed to list tags' }, { status: 400 })
  }
}

export async function POST(request: Request) {
  if (!await requireUser(['ADMIN', 'ACCOUNTANT'])) return NextResponse.json({ error: 'Accountant access required' }, { status: 403 })
  try {
    const body = (await request.json()) as { name?: string; branch?: string; eventId?: string; description?: string }
    const { name, branch, eventId, description } = body
    if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })
    const tag = await createTag({ name, branch, eventId, description })
    return NextResponse.json(tag, { status: 201 })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg || 'Failed to create tag' }, { status: 400 })
  }
}
