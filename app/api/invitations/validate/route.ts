import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { prisma } from '@/lib/prisma'
import { rateLimit } from '@/lib/rate-limit'

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')
  if (!token) return NextResponse.json({ valid: false, error: 'Missing token' }, { status: 400 })

  const limited = await rateLimit(request, { keyPrefix: 'invite-validate', limit: 30, windowMs: 60_000 })
  if (limited) return limited

  const tokenHash = createHash('sha256').update(token).digest('hex')
  const invitation = await prisma.userInvitation.findFirst({
    where: {
      tokenHash,
      acceptedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { email: true, role: true, expiresAt: true },
  })

  if (!invitation) {
    return NextResponse.json({ valid: false, error: 'Invalid or expired invitation' }, { status: 404 })
  }

  return NextResponse.json({
    valid: true,
    email: invitation.email,
    role: invitation.role,
    expiresAt: invitation.expiresAt.toISOString(),
  })
}
