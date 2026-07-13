import { NextResponse } from 'next/server'
import { buildSummary } from '@/lib/summary'
import { requireUser } from '@/lib/authz'
import { logger } from '@/lib/logger'

export async function GET(request: Request) {
  if (!await requireUser()) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  try {
    const url = new URL(request.url)
    const branch = url.searchParams.get('branch') || 'main'
    const asOf = url.searchParams.get('asOf') || url.searchParams.get('asof')
    const data = await buildSummary({ branch, asOf })
    return NextResponse.json(data)
  } catch (error) {
    logger.error('Summary error', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ error: 'Failed to load summary' }, { status: 500 })
  }
}
