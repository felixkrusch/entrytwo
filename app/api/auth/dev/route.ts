import { NextResponse, NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { encode } from 'next-auth/jwt'
import { randomUUID } from 'crypto'
import { getRequestId } from '@/lib/correlation'
import { rateLimit } from '@/lib/rate-limit'

// Simple dev-only sign-in - creates session and sets cookie
export async function POST(request: NextRequest) {
  const requestId = getRequestId(request)

  const limited = await rateLimit(request, { keyPrefix: 'auth-dev', limit: 5, windowMs: 5 * 60_000 })
  if (limited) {
    limited.headers.set('x-request-id', requestId)
    return limited
  }

  if (process.env.NODE_ENV === 'production' || process.env.SMTP_HOST) {
    const res = NextResponse.json({ error: 'Not available in production', requestId }, { status: 403 })
    res.headers.set('x-request-id', requestId)
    return res
  }

  const { email } = await request.json()
  if (!email) {
    const res = NextResponse.json({ error: 'Email required', requestId }, { status: 400 })
    res.headers.set('x-request-id', requestId)
    return res
  }

  try {
    // Find or create user
    let user = await prisma.user.findUnique({ where: { email } })
    if (user?.disabled) {
      return NextResponse.json({ error: 'Account disabled' }, { status: 403 })
    }
    if (!user) {
      user = await prisma.user.create({
        data: { email, role: 'ADMIN' },
      })
    }

    // Always load fresh to get current sessionVersion (auth callbacks require it to match)
    const fresh = await prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, email: true, name: true, role: true, sessionVersion: true },
    })
    if (!fresh) {
      return NextResponse.json({ error: 'Failed' }, { status: 500 })
    }

    // Create session token (include sessionVersion so the auth callbacks accept it)
    const cookieName = 'authjs.session-token'
    const token = await encode({
      token: {
        id: fresh.id,
        email: fresh.email,
        name: fresh.name,
        role: fresh.role,
        picture: null,
        sub: fresh.id,
        totpSessionId: randomUUID(),
        sessionVersion: fresh.sessionVersion ?? 0,
      },
      secret: process.env.AUTH_SECRET || 'development-secret',
      salt: cookieName,
    })

    // Redirect directly to the dashboard with the session cookie set
    const redirectResponse = NextResponse.redirect(new URL('/app', request.url), 303)
    redirectResponse.cookies.set(cookieName, token, {
      httpOnly: true,
      secure: false,
      maxAge: 60 * 60 * 24,
      path: '/',
      sameSite: 'lax',
    })
    redirectResponse.headers.set('x-request-id', requestId)
    return redirectResponse
  } catch {
    const res = NextResponse.json({ error: 'Failed', requestId }, { status: 500 })
    res.headers.set('x-request-id', requestId)
    return res
  }
}
