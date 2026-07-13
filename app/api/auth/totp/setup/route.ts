import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/authz'
import { prisma } from '@/lib/prisma'
import { encrypt } from '@/lib/encryption'
import { generateTotpSecret } from '@/lib/totp'
import { rateLimit } from '@/lib/rate-limit'

export async function GET(request: NextRequest) {
  const session = await requireUser()
  if (!session) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  const limited = await rateLimit(request, { keyPrefix: `totp-setup:${session.user.id}`, limit: 5, windowMs: 10 * 60_000 })
  if (limited) return limited

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { email: true, totpEnabled: true },
  })
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  if (user.totpEnabled) return NextResponse.json({ error: 'TOTP is already enabled' }, { status: 409 })

  const secret = generateTotpSecret()
  await prisma.$transaction([
    prisma.totpRecoveryCode.deleteMany({ where: { userId: session.user.id } }),
    prisma.user.update({
      where: { id: session.user.id },
      data: { totpSecret: encrypt(secret), totpEnabled: false, totpLastUsedStep: null },
    }),
  ])

  const label = `entrytwo:${user.email}`
  const totpUri = `otpauth://totp/${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent('entrytwo')}&algorithm=SHA1&digits=6&period=30`
  return NextResponse.json({ secret, totpUri })
}
