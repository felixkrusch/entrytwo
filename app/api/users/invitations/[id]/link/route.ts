import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/authz'
import { enqueueJob } from '@/lib/jobs'
import { getRequestId } from '@/lib/correlation'
import {
  buildInviteLink,
  hashInvitationToken,
  queueInvitationEmail,
} from '@/lib/invitationDelivery'

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(request)
  const session = await requireUser(['ADMIN'])
  if (!session) {
    const res = NextResponse.json({ error: 'Admin access required', requestId }, { status: 403 })
    res.headers.set('x-request-id', requestId)
    return res
  }

  const { id } = await context.params
  const invitation = await prisma.userInvitation.findUnique({ where: { id } })
  if (!invitation || invitation.acceptedAt) {
    const res = NextResponse.json({ error: 'Invitation not found or already accepted', requestId }, { status: 404 })
    res.headers.set('x-request-id', requestId)
    return res
  }

  const token = randomBytes(32).toString('base64url')
  const tokenHash = hashInvitationToken(token)
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

  await prisma.userInvitation.update({
    where: { id },
    data: { tokenHash, expiresAt },
  })

  const inviteLink = buildInviteLink(token)
  const deliveryJobId = await queueInvitationEmail(
    (type, key, payload) => enqueueJob(type, key, payload),
    {
      invitationId: id,
      email: invitation.email,
      token,
      expiresAt: expiresAt.toISOString(),
    },
  )

  const res = NextResponse.json({ inviteLink, deliveryJobId, requestId })
  res.headers.set('x-request-id', requestId)
  return res
}
