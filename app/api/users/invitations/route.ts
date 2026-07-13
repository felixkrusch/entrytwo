import { NextResponse, NextRequest } from 'next/server'
import { requireUser } from '@/lib/authz'
import { prisma } from '@/lib/prisma'
import { getRequestId } from '@/lib/correlation'

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request)
  if (!await requireUser(['ADMIN'])) {
    const res = NextResponse.json({ error: 'Admin access required', requestId }, { status: 403 })
    res.headers.set('x-request-id', requestId)
    return res
  }
  const invitations = await prisma.userInvitation.findMany({
    orderBy: { createdAt: 'desc' }, take: 100,
    select: { id: true, email: true, role: true, createdAt: true, expiresAt: true, acceptedAt: true },
  })
  const deliveryJobs = await prisma.durableJob.findMany({
    where: { idempotencyKey: { startsWith: 'invitation-email:' } },
    select: { idempotencyKey: true, status: true, lastError: true },
  })
  const byInvitation = new Map(deliveryJobs.map(job => [job.idempotencyKey.slice('invitation-email:'.length), job]))
  const res = NextResponse.json(invitations.map(invitation => ({ ...invitation, delivery: byInvitation.get(invitation.id) || null, requestId })))
  res.headers.set('x-request-id', requestId)
  return res
}
