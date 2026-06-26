import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await auth()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Generate a base32 secret for TOTP
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let secret = ''
  for (let i = 0; i < 32; i++) {
    secret += chars.charAt(Math.floor(Math.random() * chars.length))
  }

  // Store for this user
  await prisma.user.update({
    where: { email: session.user.email },
    data: { totpSecret: secret, totpEnabled: false },
  })

  const totpUri = `otpauth://totp/entrytwo:${encodeURIComponent(session.user.email)}?secret=${secret}&issuer=entrytwo`

  return NextResponse.json({ secret, totpUri })
}