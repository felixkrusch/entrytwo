import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { encryptCredentials } from '@/lib/encryption'

export async function GET() {
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
  try {
    const body = await request.json()
    const { accountId, provider, externalId, credentials } = body

    if (!accountId || !provider || !externalId) {
      return NextResponse.json({ error: 'accountId, provider, and externalId required' }, { status: 400 })
    }

    const connection = await prisma.bankConnection.create({
      data: {
        accountId,
        provider,
        externalId,
        credentials: credentials ? encryptCredentials(credentials) : undefined,
      },
      include: { account: true },
    })

    return NextResponse.json(connection, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Failed to create connection' }, { status: 500 })
  }
}