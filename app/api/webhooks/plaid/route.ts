import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { encryptCredentials, decryptCredentials } from '@/lib/encryption'

// Plaid OAuth flow: Step 1 - Get link token
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { action, code } = body

    if (action === 'link_token') {
      // In production, call Plaid API to get link token
      // For now, return a placeholder
      const clientId = process.env.PLAID_CLIENT_ID
      const secret = process.env.PLAID_SECRET
      
      if (!clientId || !secret) {
        return NextResponse.json({ error: 'Plaid not configured' }, { status: 500 })
      }

      // This would call: https://development.plaid.com/link/token/create
      // Return redirect URL to Plaid Link component
      return NextResponse.json({ 
        linkToken: 'placeholder-link-token',
        message: 'Configure Plaid credentials in .env'
      })
    }

    if (action === 'exchange') {
      // Exchange public token for access token
      // In production: call Plaid /item/public_token/exchange
      // Then store encrypted access token in BankConnection
      const mockAccessToken = `mock-plaid-access-${Date.now()}`
      
      // Find or create a bank account connection for this
      const accounts = await prisma.account.findMany({ where: { type: 'ASSET' } })
      if (accounts.length === 0) {
        return NextResponse.json({ error: 'No asset accounts available' }, { status: 400 })
      }

      const connection = await prisma.bankConnection.create({
        data: {
          accountId: accounts[0].id,
          provider: 'plaid',
          externalId: `plaid-${Date.now()}`,
          credentials: encryptCredentials({ accessToken: mockAccessToken }),
        },
      })

      return NextResponse.json({ success: true, connectionId: connection.id })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch {
    return NextResponse.json({ error: 'Plaid OAuth failed' }, { status: 500 })
  }
}