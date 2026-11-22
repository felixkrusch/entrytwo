import { NextResponse, NextRequest } from 'next/server'
import { requireUser } from '@/lib/authz'
import { prisma } from '@/lib/prisma'
import { getRequestId } from '@/lib/correlation'
import { INVITATION_EMAIL_KEY_PREFIX, latestDeliveryByInvitation } from '@/lib/invitationDelivery'

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
    where: { idempotencyKey: { startsWith: INVITATION_EMAIL_KEY_PREFIX } },
    select: { idempotencyKey: true, status: true, lastError: true },
    orderBy: { createdAt: 'desc' },
  })
  const byInvitation = latestDeliveryByInvitation(deliveryJobs)
  const res = NextResponse.json(invitations.map(invitation => {
    const job = byInvitation.get(invitation.id)
    return {
      ...invitation,
      delivery: job ? { status: job.status, lastError: job.lastError } : null,
      requestId,
    }
  }))
  res.headers.set('x-request-id', requestId)
  return res
}
