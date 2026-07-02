import { NextResponse } from 'next/server'
import { createTag, listTags } from '@/lib/accounting/tag'

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const branch = url.searchParams.get('branch') || undefined
    const tags = await listTags(branch)
    return NextResponse.json(tags)
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Failed to list tags' }, { status: 400 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { name, branch, eventId, description } = body
    if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })
    const tag = await createTag({ name, branch, eventId, description })
    return NextResponse.json(tag, { status: 201 })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Failed to create tag' }, { status: 400 })
  }
}
