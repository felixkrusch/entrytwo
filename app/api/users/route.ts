import { NextResponse, NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { requireUser } from '@/lib/authz'
import { createHash, randomBytes } from 'crypto'
import { enqueueJob } from '@/lib/jobs'
import { getRequestId } from '@/lib/correlation'

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
      take: 100,
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
      return NextResponse.json({ error: 'Invalid data' }, { status: 400 })
    }

    const { email, role } = parsed.data
    const normalizedEmail = email.toLowerCase()
    if (await prisma.user.findUnique({ where: { email: normalizedEmail } })) return NextResponse.json({ error: 'Email already has an account' }, { status: 409 })
    const token = randomBytes(32).toString('base64url')
    const invitation = await prisma.userInvitation.create({ data: {
      email: normalizedEmail, role: role || 'ACCOUNTANT', tokenHash: createHash('sha256').update(token).digest('hex'),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), createdById: session.user.id,
    } })

    // Audit
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

    let deliveryJobId: string | null = null
    const baseUrl = process.env.APP_PUBLIC_URL || process.env.AUTH_URL || process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
    const inviteLink = `${baseUrl.replace(/\/$/, '')}/auth/invite?token=${encodeURIComponent(token)}`

    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
      const job = await enqueueJob('EMAIL_INVITATION', `invitation-email:${invitation.id}`, { email: invitation.email, token, expiresAt: invitation.expiresAt.toISOString() })
      deliveryJobId = job.id
    }

    const res = NextResponse.json({
      ...invitation,
      deliveryJobId,
      inviteLink,
      token: process.env.SMTP_HOST ? undefined : token,
      requestId,
    }, { status: 201 })
    res.headers.set('x-request-id', requestId)
    return res
  } catch (e: unknown) {
    const err = e as { code?: string }
    if (err.code === 'P2002') {
      return NextResponse.json({ error: 'Email already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Failed to create user' }, { status: 500 })
  }
}
