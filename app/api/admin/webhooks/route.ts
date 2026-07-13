import { NextResponse, NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/authz'
import { getRequestId } from '@/lib/correlation'

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request)
  if (!await requireUser(['ADMIN'])) {
    const res = NextResponse.json({ error: 'Admin access required', requestId }, { status: 403 })
    res.headers.set('x-request-id', requestId)
    return res
  }
  const [events, jobs] = await Promise.all([
    prisma.webhookEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }),
    prisma.durableJob.findMany({ where: { type: { startsWith: 'WEBHOOK_' } }, orderBy: { createdAt: 'desc' }, take: 100, include: { attemptHistory: { orderBy: { startedAt: 'desc' }, take: 5 } } }),
  ])
  const res = NextResponse.json({ events, jobs, requestId })
  res.headers.set('x-request-id', requestId)
  return res
}
