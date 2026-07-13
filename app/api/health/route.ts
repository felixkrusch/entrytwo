import { NextResponse, NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getRequestId } from '@/lib/correlation'
import { rateLimit } from '@/lib/rate-limit'

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request)

  // Light protection for public health endpoint (prevent abuse while keeping it usable for probes)
  const limited = await rateLimit(request, { keyPrefix: 'health', limit: 120, windowMs: 60_000 })
  if (limited) {
    limited.headers.set('x-request-id', requestId)
    return limited
  }

  try {
    const dbCheck = await prisma.$queryRaw`SELECT 1`.catch(() => null)

    // Lightweight readiness for required production secrets (do not leak values)
    const missingProdSecrets: string[] = []
    if (process.env.NODE_ENV === 'production') {
      const required = ['DATABASE_URL', 'AUTH_SECRET', 'ENCRYPTION_KEY', 'JOB_RUNNER_SECRET']
      for (const k of required) if (!process.env[k]) missingProdSecrets.push(k)
    }

    const ready = !!dbCheck && missingProdSecrets.length === 0

    const body = {
      status: ready ? 'ok' : 'degraded',
      ready,
      timestamp: new Date().toISOString(),
      database: dbCheck ? 'connected' : 'disconnected',
      version: process.env.npm_package_version || 'unknown',
      requestId,
      ...(missingProdSecrets.length ? { missingProdSecrets } : {}),
    }

    return NextResponse.json(body, {
      status: ready ? 200 : 503,
      headers: { 'x-request-id': requestId },
    })
  } catch (error) {
    return NextResponse.json({
      status: 'error',
      ready: false,
      timestamp: new Date().toISOString(),
      error: (error as Error)?.message || 'unknown',
      requestId,
    }, {
      status: 500,
      headers: { 'x-request-id': requestId },
    })
  }
}
