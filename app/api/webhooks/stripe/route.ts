import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function POST(request: Request) {
  if (!process.env.SMTP_HOST) {
    // Dev mode - trust the payload
    const body = await request.json()
    await handleStripeEvent(body)
    return NextResponse.json({ received: true })
  }

  // Production - verify signature
  const signature = request.headers.get('stripe-signature')
  const body = await request.text()

  // TODO: Implement signature verification
  await handleStripeEventSafe(body)
  return NextResponse.json({ received: true })
}

async function handleStripeEvent(data: Record<string, unknown>) {
  const eventType = (data as any).type as string | undefined
  const eventData = (data as any).data?.object as Record<string, unknown> | undefined

  if (!eventType || !eventData) return

  const connection = await prisma.bankConnection.findFirst({
    where: { provider: 'stripe' },
  })

  if (!connection) return

  await prisma.feedTransaction.create({
    data: {
      connectionId: connection.id,
      externalId: (eventData.id as string) || '',
      date: new Date(((eventData.created as number) || Date.now()) * 1000),
      description: (eventData.description as string) || eventType,
      merchant: eventData.description as string | undefined,
      amount: (typeof eventData.amount === 'number' ? eventData.amount : 0) / 100,
      currency: (eventData.currency as string) || 'usd',
      rawData: {},
      status: 'pending',
    },
  })
}

async function handleStripeEventSafe(body: string) {
  try {
    const data = JSON.parse(body) as Record<string, unknown>
    await handleStripeEvent(data)
  } catch (error) {
    console.error('Stripe webhook error:', error)
  }
}