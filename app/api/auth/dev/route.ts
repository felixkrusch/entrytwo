import { NextResponse, NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { encode } from 'next-auth/jwt'
import { randomUUID } from 'crypto'
import { getRequestId } from '@/lib/correlation'
import { rateLimit } from '@/lib/rate-limit'
import { canProvisionNewUser, findActiveInvitation, normalizeEmail } from '@/lib/authAccess'

/**
 * Dev-only instant email session.
 * Hard-disabled when NODE_ENV === 'production'.
 * Independent of SMTP/OAuth so local work stays frictionless.
 */
export async function POST(request: NextRequest) {
  const requestId = getRequestId(request)

  const limited = await rateLimit(request, { keyPrefix: 'auth-dev', limit: 20, windowMs: 5 * 60_000 })
  if (limited) {
    limited.headers.set('x-request-id', requestId)
    return limited
  }

  if (process.env.NODE_ENV === 'production') {
    const res = NextResponse.json({ error: 'Not available in production', requestId }, { status: 403 })
    res.headers.set('x-request-id', requestId)
    return res
  }

  const body = await request.json().catch(() => ({}))
  const email = typeof body.email === 'string' ? normalizeEmail(body.email) : ''
  if (!email || !email.includes('@')) {
    const res = NextResponse.json({ error: 'Email required', requestId }, { status: 400 })
    res.headers.set('x-request-id', requestId)
    return res
  }

  try {
    let user = await prisma.user.findUnique({ where: { email } })
    if (user?.disabled) {
      return NextResponse.json({ error: 'Account disabled', requestId }, { status: 403 })
    }

    if (!user) {
      const gate = await canProvisionNewUser(email)
      if (!gate.ok) {
        return NextResponse.json(
          {
            error:
              gate.reason === 'NO_ACTIVE_INVITATION'
                ? 'No account for this email. Accept an invitation first.'
                : 'Sign-in not allowed',
            requestId,
          },
          { status: 403 },
        )
      }

      const invitation = await findActiveInvitation(email)
      if (invitation) {
        user = await prisma.$transaction(async tx => {
          const created = await tx.user.create({
            data: { email, role: invitation.role, emailVerified: new Date() },
          })
          await tx.userInvitation.update({
            where: { id: invitation.id },
            data: { acceptedAt: new Date() },
          })
          return created
        })
      } else {
        user = await prisma.user.create({
          data: { email, role: 'ADMIN', emailVerified: new Date() },
        })
      }
    }

    const fresh = await prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, email: true, name: true, role: true, sessionVersion: true, image: true },
    })
    if (!fresh) {
      return NextResponse.json({ error: 'Failed', requestId }, { status: 500 })
    }

    const cookieName = 'authjs.session-token'
    const secret = process.env.AUTH_SECRET || 'development-secret'
    const token = await encode({
      token: {
        id: fresh.id,
        email: fresh.email,
        name: fresh.name,
        role: fresh.role,
        picture: fresh.image,
        sub: fresh.id,
        totpSessionId: randomUUID(),
        sessionVersion: fresh.sessionVersion ?? 0,
      },
      secret,
      salt: cookieName,
    })

    const redirectResponse = NextResponse.redirect(new URL('/app', request.url), 303)
    redirectResponse.cookies.set(cookieName, token, {
      httpOnly: true,
      secure: false,
      maxAge: 60 * 60 * 24 * 7,
      path: '/',
      sameSite: 'lax',
    })
    redirectResponse.headers.set('x-request-id', requestId)
    return redirectResponse
  } catch (error) {
    console.error('[auth/dev]', requestId, error instanceof Error ? error.message : error)
    const res = NextResponse.json({ error: 'Failed', requestId }, { status: 500 })
    res.headers.set('x-request-id', requestId)
    return res
  }
}
