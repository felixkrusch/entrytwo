import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/authz'
import { prisma } from '@/lib/prisma'
import { decrypt } from '@/lib/encryption'
import { generateRecoveryCodes, hashRecoveryCode, verifyTotp } from '@/lib/totp'
import { createTotpSessionProof, TOTP_SESSION_COOKIE } from '@/lib/totpSession'
import { rateLimit } from '@/lib/rate-limit'

export async function POST(request: NextRequest) {
  const session = await requireUser()
  if (!session?.totpSessionId) return NextResponse.json({ error: 'Primary authentication required' }, { status: 401 })
  const limited = await rateLimit(request, { keyPrefix: `totp:${session.user.id}`, limit: 10, windowMs: 10 * 60_000 })
  if (limited) return limited

  const body = await request.json().catch(() => ({}))
  const token = typeof body.token === 'string' ? body.token.trim() : ''
  const recoveryCode = typeof body.recoveryCode === 'string' ? body.recoveryCode.trim() : ''
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { totpSecret: true, totpEnabled: true, totpLastUsedStep: true },
  })
  if (!user?.totpSecret) return NextResponse.json({ error: 'TOTP has not been configured' }, { status: 409 })

  let usedRecoveryCodeId: string | null = null
  let verifiedStep: bigint | null = null
  if (recoveryCode && user.totpEnabled) {
    const hash = hashRecoveryCode(recoveryCode, session.user.id)
    usedRecoveryCodeId = (await prisma.totpRecoveryCode.findUnique({
      where: { userId_hash: { userId: session.user.id, hash } },
      select: { id: true },
    }))?.id || null
  } else if (token) {
    verifiedStep = verifyTotp(decrypt(user.totpSecret), token)
    if (verifiedStep !== null && user.totpEnabled && user.totpLastUsedStep !== null && verifiedStep <= user.totpLastUsedStep) {
      verifiedStep = null
    }
  }

  if (!usedRecoveryCodeId && verifiedStep === null) {
    await prisma.event.create({ data: { eventType: 'MANUAL_ADJUSTMENT', entityType: 'User', entityId: session.user.id, createdBy: session.user.id, payload: { action: 'TOTP_VERIFICATION_FAILED' } } })
    return NextResponse.json({ error: 'Invalid or expired verification code' }, { status: 400 })
  }

  let recoveryCodes: string[] | undefined
  if (!user.totpEnabled) {
    const generatedRecoveryCodes = generateRecoveryCodes()
    recoveryCodes = generatedRecoveryCodes
    await prisma.$transaction(async tx => {
      const enabled = await tx.user.updateMany({
        where: { id: session.user.id, totpEnabled: false },
        data: { totpEnabled: true, totpLastUsedStep: verifiedStep },
      })
      if (enabled.count !== 1) throw new Error('TOTP setup was already completed')
      await tx.totpRecoveryCode.deleteMany({ where: { userId: session.user.id } })
      await tx.totpRecoveryCode.createMany({
        data: generatedRecoveryCodes.map(code => ({ userId: session.user.id, hash: hashRecoveryCode(code, session.user.id) })),
      })
    })
  } else if (usedRecoveryCodeId) {
    const deleted = await prisma.totpRecoveryCode.deleteMany({ where: { id: usedRecoveryCodeId, userId: session.user.id } })
    if (deleted.count !== 1) return NextResponse.json({ error: 'Recovery code has already been used' }, { status: 400 })
  } else {
    const advanced = await prisma.user.updateMany({
      where: {
        id: session.user.id,
        OR: [{ totpLastUsedStep: null }, { totpLastUsedStep: { lt: verifiedStep! } }],
      },
      data: { totpLastUsedStep: verifiedStep },
    })
    if (advanced.count !== 1) return NextResponse.json({ error: 'Verification code has already been used' }, { status: 400 })
  }

  await prisma.event.create({ data: { eventType: 'MANUAL_ADJUSTMENT', entityType: 'User', entityId: session.user.id, createdBy: session.user.id, payload: { action: user.totpEnabled ? (usedRecoveryCodeId ? 'TOTP_RECOVERY_USED' : 'TOTP_VERIFIED') : 'TOTP_ENABLED' } } })
  const proof = createTotpSessionProof(session.user.id, session.totpSessionId)
  const response = NextResponse.json({ ok: true, recoveryCodes })
  response.cookies.set(TOTP_SESSION_COOKIE, proof.value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: proof.maxAge,
  })
  return response
}
