import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { token } = await request.json()

  // In production, verify TOTP token using proper library (e.g. @nopremailer/totp)
  // For demo: just check format and enable
  if (!token || !/^\d{6}$/.test(token)) {
    return NextResponse.json({ error: 'Invalid token format' }, { status: 400 })
  }

  // Enable TOTP
  await prisma.user.update({
    where: { email: session.user.email },
    data: { totpEnabled: true },
  })

  return NextResponse.json({ ok: true })
}