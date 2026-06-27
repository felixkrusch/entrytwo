import { createHmac, timingSafeEqual } from 'crypto'

export function verifySignature(body: string, signature: string | null): Record<string, unknown> | null {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret || !signature) return null

  try {
    const sigParts = signature.split(',')
    const sigMap = new Map<string, string>()
    for (const part of sigParts) {
      const [key, value] = part.split('=')
      sigMap.set(key, value || '')
    }
    const expectedSignature = sigMap.get('v1') || ''

    const computedSignature = createHmac('sha256', secret)
      .update(body, 'utf8')
      .digest('hex')

    if (!timingSafeEqual(Buffer.from(computedSignature, 'hex'), Buffer.from(expectedSignature, 'hex'))) {
      return null
    }

    return JSON.parse(body)
  } catch {
    return null
  }
}