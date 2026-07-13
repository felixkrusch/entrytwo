import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { encode } from 'next-auth/jwt'
import { randomUUID } from 'crypto'

// Simple dev-only sign-in - creates session and sets cookie
export async function POST(request: Request) {
  if (process.env.NODE_ENV === 'production' || process.env.SMTP_HOST) {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 })
  }

  const { email } = await request.json()
  if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 })

  try {
    // Find or create user
    let user = await prisma.user.findUnique({ where: { email } })
    if (!user) {
      user = await prisma.user.create({
        data: { email, role: 'ADMIN' },
      })
    }

    // Create session token
    const cookieName = 'authjs.session-token'
    const token = await encode({
      token: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        picture: null,
        sub: user.id,
        totpSessionId: randomUUID(),
      },
      secret: process.env.AUTH_SECRET || 'development-secret',
      salt: cookieName,
    })

    const response = NextResponse.json({ ok: true })
    response.cookies.set(cookieName, token, {
      httpOnly: true,
      secure: false,
      maxAge: 60 * 60 * 24,
      path: '/',
      sameSite: 'lax',
    })

    return response
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
