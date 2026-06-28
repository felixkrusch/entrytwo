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

  // In production, fetch cert from certUrl and verify signature
  // For dev mode, trust the webhook
  if (!process.env.SMTP_HOST) return true

  // Placeholder - actual verification would require PayPal cert validation
  return false
}