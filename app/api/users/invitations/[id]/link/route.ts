import { NextResponse } from 'next/server'
import { randomBytes, createHash } from 'crypto'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/authz'

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await requireUser(['ADMIN'])
  if (!session) return NextResponse.json({ error: 'Admin access required' }, { status: 403 })

  const { id } = await context.params
  const invitation = await prisma.userInvitation.findUnique({ where: { id } })
  if (!invitation || invitation.acceptedAt) {
    return NextResponse.json({ error: 'Invitation not found or already accepted' }, { status: 404 })
  }

  // Rotate to a fresh token (old links become invalid)
  const token = randomBytes(32).toString('base64url')
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

  await prisma.userInvitation.update({
    where: { id },
    data: { tokenHash, expiresAt },
  })

  const baseUrl = process.env.APP_PUBLIC_URL || process.env.AUTH_URL || process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
  const inviteLink = `${baseUrl.replace(/\/$/, '')}/auth/invite?token=${encodeURIComponent(token)}`

  // Optionally re-enqueue email job if SMTP configured
  let deliveryJobId: string | null = null
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    const { enqueueJob } = await import('@/lib/jobs')
    const job = await enqueueJob('EMAIL_INVITATION', `invitation-email:${id}`, {
      email: invitation.email,
      token,
      expiresAt: expiresAt.toISOString(),
    })
    deliveryJobId = job.id
  }

  return NextResponse.json({ inviteLink, deliveryJobId })
}
