import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { decryptCredentials } from '@/lib/encryption'

async function syncStripe(connection: { id: string; credentials: string | null }) {
  if (!connection.credentials) {
    throw new Error('No credentials stored for Stripe connection')
  }

  const creds = decryptCredentials(connection.credentials)
  if (!creds?.apiKey) {
    throw new Error('No apiKey in credentials')
  }

  const apiKey = creds.apiKey as string
  const stripeBase = apiKey.startsWith('sk_test') ? 'https://api.stripe.com' : 'https://api.stripe.com'

  // Fetch charges from last 30 days
  const response = await fetch(
    `${stripeBase}/v1/charges?created[gte]=${Math.floor(Date.now() / 1000) - 2592000}&limit=100`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    }
  )

  if (!response.ok) {
    throw new Error(`Stripe API error: ${response.status}`)
  }

  const data = await response.json()
  let imported = 0

  for (const charge of data.data || []) {
    // Check if already exists
    const exists = await prisma.feedTransaction.findUnique({
      where: {
        connectionId_externalId: {
          connectionId: connection.id,
          externalId: charge.id,
        },
      },
    })

    if (exists) continue

    await prisma.feedTransaction.create({
      data: {
        connectionId: connection.id,
        externalId: charge.id,
        date: new Date(charge.created * 1000),
        description: charge.description || charge.statement_descriptor,
        merchant: charge.billing_details?.name || charge.description,
        amount: charge.amount / 100,
        currency: charge.currency,
        rawData: { charge } as any,
        status: 'pending',
      },
    })
    imported++
  }

  return { imported, total: data.data?.length || 0 }
}

export async function POST(request: Request) {
  try {
    const { connectionId } = await request.json()

    const connection = await prisma.bankConnection.findUnique({
      where: { id: connectionId },
    })

    if (!connection) {
      return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
    }

    let result: { imported: number; total: number } | null = null

    if (connection.provider === 'stripe') {
      result = await syncStripe(connection)
    } else if (connection.provider === 'paypal') {
      // PayPal sync would use credentials.accessToken + API calls
      // Implementation similar to Stripe above
    }

    await prisma.bankConnection.update({
      where: { id: connectionId },
      data: { lastSyncAt: new Date() },
    })

    return NextResponse.json({
      status: 'synced',
      lastSyncAt: new Date().toISOString(),
      imported: result?.imported || 0,
    })
  } catch (error: unknown) {
    console.error('Sync error:', error)
    const message = error instanceof Error ? error.message : 'Failed to sync'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}