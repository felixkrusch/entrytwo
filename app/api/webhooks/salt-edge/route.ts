import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { encryptCredentials } from '@/lib/encryption'

// Salt Edge OAuth flow
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { action, code } = body

    if (action === 'connect') {
      const appId = process.env.SALTEDGE_APP_ID
      const secret = process.env.SALTEDGE_SECRET
      
      if (!appId || !secret) {
        return NextResponse.json({ error: 'Salt Edge not configured' }, { status: 500 })
      }

      // In production, exchange code for access token via:
      // https://www.saltedge.com/api/v1/oauth/token
      
      const mockToken = `mock-saltedge-token-${Date.now()}`
      
      // Find or create a bank account connection
      const accounts = await prisma.account.findMany({ where: { type: 'ASSET' } })
      if (accounts.length === 0) {
        return NextResponse.json({ error: 'No asset accounts available' }, { status: 400 })
      }

      const connection = await prisma.bankConnection.create({
        data: {
          accountId: accounts[0].id,
          provider: 'salt-edge',
          externalId: `saltedge-${Date.now()}`,
          credentials: encryptCredentials({ accessToken: mockToken }),
        },
      })

      return NextResponse.json({ success: true, connectionId: connection.id })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch {
    return NextResponse.json({ error: 'Salt Edge OAuth failed' }, { status: 500 })
  }
}