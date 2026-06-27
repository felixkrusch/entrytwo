import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function POST(request: Request) {
  try {
    const { connectionId } = await request.json()

    const connection = await prisma.bankConnection.findUnique({
      where: { id: connectionId },
    })

    if (!connection) {
      return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
    }

    // For now, this would trigger a sync with the provider
    // In production, this would call the provider's API
    // For dev mode, we just acknowledge the sync request

    await prisma.bankConnection.update({
      where: { id: connectionId },
      data: { lastSyncAt: new Date() },
    })

    return NextResponse.json({ status: 'synced', lastSyncAt: new Date().toISOString() })
  } catch (error) {
    console.error('Sync error:', error)
    return NextResponse.json({ error: 'Failed to sync' }, { status: 500 })
  }
}