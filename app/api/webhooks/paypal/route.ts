import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function POST(request: Request) {
  const body = await request.text()

  // Verify PayPal webhook signature in production
  // In production with SMTP_HOST set, PayPal verification would use cert URL validation
  // For now, trust webhooks in dev mode (SMTP_HOST not set)
  if (process.env.SMTP_HOST) {
    const signature = request.headers.get('paypal-transmission-sig')
    if (!signature) {
      return NextResponse.json({ error: 'Missing signature' }, { status: 401 })
    }
    // Note: Full PayPal verification requires cert validation (see lib/webhook.ts)
  }

  try {
    const payload = JSON.parse(body) as Record<string, unknown>
    await handlePaypalEvent(payload)
  } catch (error) {
    console.error('PayPal webhook error:', error)
  }

  return NextResponse.json({ received: true })
}

async function handlePaypalEvent(data: Record<string, unknown>) {
  const eventType = data.event_type as string
  const resource = (data.resource as Record<string, unknown>) || {}
  const amountObj = (resource.amount as Record<string, unknown>) || {}
  const merchantInfo = (resource.merchant_info as Record<string, unknown>) || {}

  if (!eventType) return

  const connection = await prisma.bankConnection.findFirst({
    where: { provider: 'paypal' },
  })

  if (!connection) {
    console.warn('No PayPal connection found')
    return
  }

  // Handle sale.completed, refund, payment-sale, etc.
  let amount = 0
  let currency = 'USD'

  if (typeof amountObj.value === 'number') {
    amount = Math.abs(amountObj.value)
    currency = (amountObj.currency_code as string) || 'USD'
  }

  await prisma.feedTransaction.create({
    data: {
      connectionId: connection.id,
      externalId: (resource.id as string) || '',
      date: new Date((resource.create_time as string) || Date.now()),
      description: (resource.description as string) || eventType,
      merchant: (merchantInfo.name as string) || (resource.partner_name as string) || (resource.payer_name as string),
      amount,
      currency,
      rawData: { type: eventType, ...(resource as any) } as any,
      status: 'pending',
    },
  })
}