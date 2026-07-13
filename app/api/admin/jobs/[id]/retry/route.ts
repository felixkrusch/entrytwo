import { NextResponse, NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { requireUser } from '@/lib/authz'
import { retryJob } from '@/lib/jobs'
import { getRequestId } from '@/lib/correlation'
import { rateLimit } from '@/lib/rate-limit'

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request)

  const limited = await rateLimit(request, { keyPrefix: 'admin-jobs-retry', limit: 30, windowMs: 60_000 })
  if (limited) {
    limited.headers.set('x-request-id', requestId)
    return limited
  }

  if (!await requireUser(['ADMIN'])) {
    const res = NextResponse.json({ error: 'Admin access required', requestId }, { status: 403 })
    res.headers.set('x-request-id', requestId)
    return res
  }
  const { id } = await context.params
  try {
    const job = await retryJob(id)
    const res = NextResponse.json({ ok: true, jobId: job.id, status: job.status, requestId })
    res.headers.set('x-request-id', requestId)
    return res
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      const res = NextResponse.json({ error: 'Job not found', requestId }, { status: 404 })
      res.headers.set('x-request-id', requestId)
      return res
    }
    const res = NextResponse.json({ error: error instanceof Error ? error.message : 'Retry failed', requestId }, { status: 500 })
    res.headers.set('x-request-id', requestId)
    return res
  }
}
