import { NextResponse } from 'next/server'
import { buildSummary } from '@/lib/summary'

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const branch = url.searchParams.get('branch') || 'main'
    const asOf = url.searchParams.get('asOf') || url.searchParams.get('asof')
    const data = await buildSummary({ branch, asOf })
    return NextResponse.json(data)
  } catch (error) {
    console.error('Summary error:', error)
    return NextResponse.json({ error: 'Failed to load summary' }, { status: 500 })
  }
}
