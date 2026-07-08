import { NextResponse } from 'next/server'
import { diffPoints } from '@/lib/accounting/diff'

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')
    if (!from || !to) return NextResponse.json({ error: 'from and to event ids required' }, { status: 400 })
    const result = await diffPoints(from, to)
    return NextResponse.json(result)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg || 'Diff failed' }, { status: 400 })
  }
}
