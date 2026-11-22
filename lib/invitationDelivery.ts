import { createHash, randomUUID } from 'crypto'
import { publicAuthBaseUrl } from '@/lib/env'
import { logger } from '@/lib/logger'
import { isSmtpConfigured } from '@/lib/smtp'

export const INVITATION_EMAIL_JOB_TYPE = 'EMAIL_INVITATION'
export const INVITATION_EMAIL_KEY_PREFIX = 'invitation-email:'

export type InvitationEmailPayload = {
  invitationId: string
  email: string
  token: string
  expiresAt: string
}

export type InvitationDeliveryDecision = 'send' | 'inactive' | 'stale_token' | 'expired' | 'email_mismatch'

type InvitationRecord = {
  email: string
  tokenHash: string
  acceptedAt: Date | null
  expiresAt: Date
}

export function hashInvitationToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export function invitationEmailIdempotencyKey(invitationId: string) {
  return `${INVITATION_EMAIL_KEY_PREFIX}${invitationId}:${randomUUID()}`
}

export function invitationIdFromDeliveryKey(key: string) {
  if (!key.startsWith(INVITATION_EMAIL_KEY_PREFIX)) return null
  const id = key.slice(INVITATION_EMAIL_KEY_PREFIX.length).split(':')[0]
  return id || null
}

export function buildInviteLink(token: string) {
  const base = publicAuthBaseUrl() || 'http://localhost:3000'
  const inviteUrl = new URL('/auth/invite', base)
  inviteUrl.searchParams.set('token', token)
  return String(inviteUrl)
}

export function invitationDeliveryDecision(
  invitation: InvitationRecord | null | undefined,
  input: { email: string; token: string; now?: Date },
): InvitationDeliveryDecision {
  if (!invitation || invitation.acceptedAt) return 'inactive'
  if (hashInvitationToken(input.token) !== invitation.tokenHash) return 'stale_token'
  if (invitation.expiresAt.getTime() <= (input.now ?? new Date()).getTime()) return 'expired'
  if (invitation.email.trim().toLowerCase() !== input.email.trim().toLowerCase()) return 'email_mismatch'
  return 'send'
}

export function latestDeliveryByInvitation<T extends { idempotencyKey: string }>(jobs: T[]) {
  const byInvitation = new Map<string, T>()
  for (const job of jobs) {
    const invitationId = invitationIdFromDeliveryKey(job.idempotencyKey)
    if (!invitationId || byInvitation.has(invitationId)) continue
    byInvitation.set(invitationId, job)
  }
  return byInvitation
}

export async function queueInvitationEmail(
  enqueue: (type: string, idempotencyKey: string, payload: InvitationEmailPayload) => Promise<{ id: string }>,
  payload: InvitationEmailPayload,
): Promise<string | null> {
  if (!isSmtpConfigured()) return null
  try {
    const job = await enqueue(
      INVITATION_EMAIL_JOB_TYPE,
      invitationEmailIdempotencyKey(payload.invitationId),
      payload,
    )
    return job.id
  } catch (error) {
    logger.error('Invitation email enqueue failed', {
      invitationId: payload.invitationId,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return null
  }
}
