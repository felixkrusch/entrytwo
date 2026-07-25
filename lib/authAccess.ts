import { prisma } from './prisma'

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

export async function findActiveInvitation(email: string) {
  const normalized = normalizeEmail(email)
  return prisma.userInvitation.findFirst({
    where: {
      email: { equals: normalized, mode: 'insensitive' },
      acceptedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  })
}

export async function countActiveAdmins() {
  return prisma.user.count({ where: { role: 'ADMIN', disabled: false } })
}

/** Whether this email may create a brand-new User row (bootstrap or open invite). */
export async function canProvisionNewUser(email: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const normalized = normalizeEmail(email)
  const existing = await prisma.user.findUnique({
    where: { email: normalized },
    select: { id: true, disabled: true },
  })
  if (existing) {
    if (existing.disabled) return { ok: false, reason: 'ACCOUNT_DISABLED' }
    return { ok: true }
  }

  const admins = await countActiveAdmins()
  if (admins === 0) return { ok: true }

  const invitation = await findActiveInvitation(normalized)
  if (!invitation) return { ok: false, reason: 'NO_ACTIVE_INVITATION' }

  // Strict: invite email must equal the identity email (case-insensitive).
  if (normalizeEmail(invitation.email) !== normalized) {
    return { ok: false, reason: 'INVITE_EMAIL_MISMATCH' }
  }

  return { ok: true }
}

export async function auditAuthFailure(input: {
  email: string
  reason: string
  provider?: string
}) {
  await prisma.event.create({
    data: {
      eventType: 'MANUAL_ADJUSTMENT',
      entityType: 'User',
      entityId: '00000000-0000-0000-0000-000000000000',
      payload: {
        action: 'AUTH_SIGN_IN_FAILURE',
        email: normalizeEmail(input.email),
        reason: input.reason,
        provider: input.provider || 'unknown',
      },
    },
  })
}

/**
 * OAuth providers must present a verified email claim when available.
 * Google: email_verified === true
 * Microsoft: prefer email / preferred_username; treat missing verified flag as ok if email present (Entra varies by tenant).
 */
export function oauthEmailIsAcceptable(
  provider: string,
  profile: Record<string, unknown> | undefined,
  userEmail: string | null | undefined,
): { ok: true; email: string } | { ok: false; reason: string } {
  const email = normalizeEmail(
    String(
      userEmail ||
        profile?.email ||
        profile?.preferred_username ||
        '',
    ),
  )
  if (!email || !email.includes('@')) return { ok: false, reason: 'MISSING_EMAIL' }

  if (provider === 'google') {
    if (profile && profile.email_verified === false) {
      return { ok: false, reason: 'EMAIL_NOT_VERIFIED' }
    }
  }

  if (provider === 'microsoft-entra-id') {
    // Reject obviously unverified personal accounts when claim is present and false
    if (profile && (profile.email_verified === false || profile.verified_primary_email === false)) {
      return { ok: false, reason: 'EMAIL_NOT_VERIFIED' }
    }
  }

  return { ok: true, email }
}
