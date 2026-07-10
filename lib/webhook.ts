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

export async function verifyPaypalSignature(body: string, headers: Record<string, string | null>): Promise<boolean> {
  const certUrl = headers['paypal-cert-url']
  const transmissionId = headers['paypal-transmission-id']
  const transmissionTime = headers['paypal-transmission-time']
  const transmissionSig = headers['paypal-transmission-sig']

  const authAlgo = headers['paypal-auth-algo']
  const webhookId = process.env.PAYPAL_WEBHOOK_ID
  const clientId = process.env.PAYPAL_CLIENT_ID
  const secret = process.env.PAYPAL_SECRET
  if (!certUrl || !transmissionId || !transmissionTime || !transmissionSig || !authAlgo || !webhookId || !clientId || !secret) return false

  try {
    const baseUrl = process.env.PAYPAL_BASE_URL || 'https://api-m.paypal.com'
    const tokenResponse = await fetch(`${baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    })
    if (!tokenResponse.ok) return false
    const token = await tokenResponse.json() as { access_token?: string }
    if (!token.access_token) return false
    const verification = await fetch(`${baseUrl}/v1/notifications/verify-webhook-signature`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_algo: authAlgo,
        cert_url: certUrl,
        transmission_id: transmissionId,
        transmission_sig: transmissionSig,
        transmission_time: transmissionTime,
        webhook_id: webhookId,
        webhook_event: JSON.parse(body),
      }),
    })
    if (!verification.ok) return false
    const result = await verification.json() as { verification_status?: string }
    return result.verification_status === 'SUCCESS'
  } catch {
    return false
  }
}
