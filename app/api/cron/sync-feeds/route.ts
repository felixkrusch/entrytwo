import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// This endpoint can be called by a CRON job for automatic nightly sync
export async function POST(request: Request) {
  try {
    // Validate CRON secret if provided
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET
    
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get all enabled connections
    const connections = await prisma.bankConnection.findMany({
      where: { syncEnabled: true },
    })

    const results = []

    for (const conn of connections) {
      try {
        // For each connection, we'd trigger a sync
        // In production, this would call the provider's API
        // For now, we just record the sync time
        await prisma.bankConnection.update({
          where: { id: conn.id },
          data: { lastSyncAt: new Date() },
        })
        results.push({ id: conn.id, status: 'synced' })
      } catch (e) {
        results.push({ id: conn.id, status: 'error', error: (e as Error).message })
      }
    }

    return NextResponse.json({ 
      success: true, 
      synced: results.length,
      results 
    })
  } catch (error) {
    console.error('Auto-sync error:', error)
    return NextResponse.json({ error: 'Auto-sync failed' }, { status: 500 })
  }
}

// Health check endpoint
export async function GET() {
  const connections = await prisma.bankConnection.count({
    where: { syncEnabled: true },
  })
  return NextResponse.json({ 
    status: 'ok',
    activeConnections: connections
  })
}