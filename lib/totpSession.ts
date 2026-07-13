import { createHmac, timingSafeEqual } from 'crypto'

export const TOTP_SESSION_COOKIE = 'entrytwo.totp-verified'
const MAX_AGE_SECONDS = 12 * 60 * 60

function secret() {
  const value = process.env.AUTH_SECRET
  if (!value) throw new Error('AUTH_SECRET is required for TOTP sessions')
  return value
}

function signature(payload: string) {
  return createHmac('sha256', secret()).update(payload).digest('base64url')
}

export function createTotpSessionProof(userId: string, sessionId: string, now = Date.now()) {
  const expiresAt = Math.floor(now / 1000) + MAX_AGE_SECONDS
  const payload = `${userId}.${sessionId}.${expiresAt}`
  return { value: `${payload}.${signature(payload)}`, maxAge: MAX_AGE_SECONDS }
}

export function verifyTotpSessionProof(value: string | undefined, userId: string, sessionId: string, now = Date.now()) {
  if (!value) return false
  const parts = value.split('.')
  if (parts.length !== 4) return false
  const [proofUserId, proofSessionId, expiresAt, submittedSignature] = parts
  if (proofUserId !== userId || proofSessionId !== sessionId || Number(expiresAt) <= Math.floor(now / 1000)) return false
  const payload = `${proofUserId}.${proofSessionId}.${expiresAt}`
  const expected = Buffer.from(signature(payload))
  const submitted = Buffer.from(submittedSignature)
  return expected.length === submitted.length && timingSafeEqual(expected, submitted)
}
