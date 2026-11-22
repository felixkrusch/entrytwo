import { NextResponse, NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { requireUser } from '@/lib/authz'
import { randomBytes } from 'crypto'
import { enqueueJob } from '@/lib/jobs'
import { getRequestId } from '@/lib/correlation'
import { adminUserFields } from '@/lib/adminUserFields'
import {
  buildInviteLink,
  hashInvitationToken,
  queueInvitationEmail,
} from '@/lib/invitationDelivery'
import { isSmtpConfigured } from '@/lib/smtp'

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  role: z.enum(['ADMIN', 'ACCOUNTANT', 'VIEWER']).optional(),
})

export async function GET() {
  if (!await requireUser(['ADMIN'])) return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: adminUserFields,
    })
    return NextResponse.json(users)
  } catch {
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request)
  const session = await requireUser(['ADMIN'])
  if (!session) {
    const res = NextResponse.json({ error: 'Admin access required', requestId }, { status: 403 })
    res.headers.set('x-request-id', requestId)
    return res
  }
  try {
    const body = await request.json()
    const parsed = createUserSchema.safeParse(body)
    if (!parsed.success) {
      const res = NextResponse.json({ error: 'Invalid data', requestId }, { status: 400 })
      res.headers.set('x-request-id', requestId)
      return res
    }

    const { email, role } = parsed.data
    const normalizedEmail = email.toLowerCase()
    if (await prisma.user.findUnique({ where: { email: normalizedEmail } })) {
      const res = NextResponse.json({ error: 'Email already has an account', requestId }, { status: 409 })
      res.headers.set('x-request-id', requestId)
      return res
    }
    const token = randomBytes(32).toString('base64url')
    const invitation = await prisma.userInvitation.create({ data: {
      email: normalizedEmail, role: role || 'ACCOUNTANT', tokenHash: hashInvitationToken(token),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), createdById: session.user.id,
    } })

    await prisma.event.create({
      data: {
        eventType: 'MANUAL_ADJUSTMENT',
        entityType: 'User',
        entityId: invitation.id,
        payload: {
          action: 'USER_INVITED',
          email: invitation.email,
          role: invitation.role,
        }, createdBy: session.user.id,
      },
    })

    const inviteLink = buildInviteLink(token)
    const deliveryJobId = await queueInvitationEmail(
      (type, key, payload) => enqueueJob(type, key, payload),
      {
        invitationId: invitation.id,
        email: invitation.email,
        token,
        expiresAt: invitation.expiresAt.toISOString(),
      },
    )

    const res = NextResponse.json({
      ...invitation,
      deliveryJobId,
      inviteLink,
      token: isSmtpConfigured() ? undefined : token,
      requestId,
    }, { status: 201 })
    res.headers.set('x-request-id', requestId)
    return res
  } catch (e: unknown) {
    const err = e as { code?: string }
    if (err.code === 'P2002') {
      const res = NextResponse.json({ error: 'Email already exists', requestId }, { status: 409 })
      res.headers.set('x-request-id', requestId)
      return res
    }
    const res = NextResponse.json({ error: 'Failed to create user', requestId }, { status: 500 })
    res.headers.set('x-request-id', requestId)
    return res
  }
}
