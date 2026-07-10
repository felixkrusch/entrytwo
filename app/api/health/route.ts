import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const dbCheck = await prisma.$queryRaw`SELECT 1`.catch(() => null)
    
    return NextResponse.json({
      status: dbCheck ? 'ok' : 'error',
      timestamp: new Date().toISOString(),
      database: dbCheck ? 'connected' : 'disconnected',
      version: process.env.npm_package_version || 'unknown',
    }, { status: dbCheck ? 200 : 503 })
  } catch (error) {
    return NextResponse.json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: (error as Error)?.message || 'unknown',
    }, { status: 500 })
  }
}
