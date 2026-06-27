import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function POST(request: Request) {
  const body = await request.text()

  // Verify PayPal webhook signature in production
  if (process.env.SMTP_HOST) {
    // TODO: Implement signature verification
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

  if (!eventType) return

  const connection = await prisma.bankConnection.findFirst({
    where: { provider: 'paypal' },
  })

  if (!connection) return

  await prisma.feedTransaction.create({
    data: {
      connectionId: connection.id,
      externalId: (resource.id as string) || '',
      date: new Date((resource.create_time as string) || Date.now()),
      description: (resource.description as string) || eventType,
      merchant: (resource.partner_name as string) || (resource.payer_name as string),
      amount: Math.abs(typeof amountObj.value === 'number' ? amountObj.value : 0),
      currency: (amountObj.currency_code as string) || 'USD',
      rawData: {},
      status: 'pending',
    },
  })
}