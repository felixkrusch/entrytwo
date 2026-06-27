import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyStripeSignature } from '@/lib/webhook'

export async function POST(request: Request) {
  const signature = request.headers.get('stripe-signature')
  const body = await request.text()

  // Production - verify signature
  if (process.env.STRIPE_WEBHOOK_SECRET) {
    if (!verifyStripeSignature(body, signature, process.env.STRIPE_WEBHOOK_SECRET)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
  }

  try {
    const data = JSON.parse(body) as Record<string, unknown>
    await handleStripeEvent(data)
  } catch (error) {
    console.error('Stripe webhook error:', error)
  }

  return NextResponse.json({ received: true })
}

async function handleStripeEvent(data: Record<string, unknown>) {
  const eventType = (data as any).type as string | undefined
  const eventData = (data as any).data?.object as Record<string, unknown> | undefined

  if (!eventType || !eventData) return

  const connection = await prisma.bankConnection.findFirst({
    where: { provider: 'stripe' },
  })

  if (!connection) {
    console.warn('No Stripe connection found')
    return
  }

  // Determine amount and currency from various Stripe event types
  let amount = 0
  let currency = 'usd'

  if ('amount' in eventData && typeof eventData.amount === 'number') {
    amount = eventData.amount
  } else if ('amount_total' in eventData && typeof eventData.amount_total === 'number') {
    amount = eventData.amount_total
  }

  currency = (eventData.currency as string) || 'usd'

  await prisma.feedTransaction.create({
    data: {
      connectionId: connection.id,
      externalId: (eventData.id as string) || '',
      date: new Date(((eventData.created as number) || Date.now()) * 1000),
      description: (eventData.description as string) || (eventData as any).statement_descriptor || eventType,
      merchant: (eventData as any).billing_details?.name || (eventData as any).description || eventType,
      amount: amount / 100,
      currency: currency,
      rawData: { type: eventType, ...(eventData as any) } as any,
      status: 'pending',
    },
  })
}