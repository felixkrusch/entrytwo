import { createHmac } from 'crypto'
import { timingSafeEqual } from 'crypto'

export function verifyStripeSignature(body: string, signature: string | null, secret: string): boolean {
  if (!signature) return false
  if (!secret) return false

  const expectedSecret = secret as string
  const signedPayload = signature.split(',').find((part) => part.startsWith('v1='))?.substring(3)
  if (!signedPayload) return false

  const expectedSignature = createHmac('sha256', expectedSecret)
    .update(body, 'utf8')
    .digest('hex')

  try {
    return timingSafeEqual(Buffer.from(signedPayload, 'hex'), Buffer.from(expectedSignature, 'hex'))
  } catch {
    return false
  }
}

export function verifyPaypalSignature(body: string, headers: Record<string, string | null>): boolean {
  const certUrl = headers['paypal-cert-url']
  const transmissionId = headers['paypal-transmission-id']
  const transmissionTime = headers['paypal-transmission-time']
  const transmissionSig = headers['paypal-transmission-sig']

  if (!certUrl || !transmissionId || !transmissionTime || !transmissionSig) return false

  // Production: must verify using PayPal's cert (not implemented in this stub yet).
  // For now we fail closed in production (SMTP_HOST set).
  if (process.env.SMTP_HOST) {
    // TODO (Phase 1+): implement real PayPal cert validation using certUrl + transmissionSig
    // For safety we currently reject when running in "production-like" mode.
    return false
  }

  // Dev / no SMTP: accept (same as before, clearly documented).
  return true
}