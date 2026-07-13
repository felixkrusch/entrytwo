import { NextResponse, NextRequest } from 'next/server'
import { requireUser } from '@/lib/authz'
import { enqueueJob } from '@/lib/jobs'
import { join } from 'path'
import { getRequestId } from '@/lib/correlation'
import { rateLimit } from '@/lib/rate-limit'

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request)

  const limited = await rateLimit(request, { keyPrefix: 'admin-backup', limit: 10, windowMs: 60_000 })
  if (limited) {
    limited.headers.set('x-request-id', requestId)
    return limited
  }

  const session = await requireUser(['ADMIN'])
  if (!session) {
    const res = NextResponse.json({ error: 'Admin access required', requestId }, { status: 403 })
    res.headers.set('x-request-id', requestId)
    return res
  }

  const outDir = join(process.cwd(), '.data', 'backups')
  const job = await enqueueJob('BACKUP_CREATE', `manual-backup:${Date.now()}`, { outDir })
  const res = NextResponse.json({ jobId: job.id, status: 'enqueued', requestId })
  res.headers.set('x-request-id', requestId)
  return res
}
