import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/authz'
import { prisma } from '@/lib/prisma'

export async function POST() {
  const session = await requireUser()
  if (!session) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  await prisma.$transaction([
    prisma.totpRecoveryCode.deleteMany({ where: { userId: session.user.id } }),
    prisma.user.update({
      where: { id: session.user.id },
      data: { totpSecret: null, totpEnabled: false, totpLastUsedStep: null },
    }),
    prisma.event.create({
      data: {
        eventType: 'MANUAL_ADJUSTMENT',
        entityType: 'User',
        entityId: session.user.id,
        createdBy: session.user.id,
        payload: { action: 'TOTP_DISABLED' },
      },
    }),
  ])

  return NextResponse.json({ ok: true })
}
