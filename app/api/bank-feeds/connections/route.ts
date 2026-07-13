import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/authz'

export async function GET() {
  if (!await requireUser(['ADMIN'])) return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  try {
    const connections = await prisma.bankConnection.findMany({
      include: { account: true },
    })
    return NextResponse.json(connections)
  } catch {
    return NextResponse.json({ error: 'Failed to fetch connections' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  if (!await requireUser(['ADMIN'])) return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  try {
    const body = await request.json()
    const { accountId, provider, externalId } = body

    if (!accountId || !provider || !externalId) {
      return NextResponse.json({ error: 'accountId, provider, and externalId required' }, { status: 400 })
    }
    if (!['stripe', 'paypal'].includes(provider)) return NextResponse.json({ error: 'Only Stripe and PayPal processor feeds are supported' }, { status: 400 })

    const connection = await prisma.bankConnection.create({
      data: {
        accountId,
        provider,
        externalId,
      },
      include: { account: true },
    })

    return NextResponse.json(connection, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Failed to create connection' }, { status: 500 })
  }
}
