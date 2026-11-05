import { NextResponse, NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getRequestId } from '@/lib/correlation'
import { rateLimit } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { authReadiness } from '@/lib/env'
import { isStorageReady } from '@/lib/storage'

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

    // Basic storage reachability (no secret values)
    const storageOk = await isStorageReady()

    // Basic webhook secret presence (no values)
    const stripeWebhook = !!process.env.STRIPE_WEBHOOK_SECRET
    const paypalWebhook = !!process.env.PAYPAL_WEBHOOK_ID

    // Job queue quick health (non-secret)
    let jobsPending = 0
    let jobsDead = 0
    try {
      jobsPending = await prisma.durableJob.count({ where: { status: { in: ['PENDING', 'RETRY'] } } })
      jobsDead = await prisma.durableJob.count({ where: { status: 'DEAD_LETTER' } })
    } catch {}

    const auth = authReadiness()
    const authOk = process.env.NODE_ENV !== 'production' || auth.productionReady
    const ready = !!dbCheck && missingProdSecrets.length === 0 && storageOk && authOk

    const body = {
      status: ready ? 'ok' : 'degraded',
      ready,
      timestamp: new Date().toISOString(),
      database: dbCheck ? 'connected' : 'disconnected',
      storage: storageOk ? 'reachable' : 'unreachable',
      auth: {
        smtp: auth.smtp,
        google: auth.google,
        microsoft: auth.microsoft,
        publicUrlConfigured: auth.publicUrlConfigured,
        authSecretConfigured: auth.authSecretConfigured,
        trustHost: auth.trustHost,
        productionReady: auth.productionReady,
      },
      webhooks: { stripe: stripeWebhook ? 'configured' : 'missing', paypal: paypalWebhook ? 'configured' : 'missing' },
      jobs: { pending: jobsPending, deadLetter: jobsDead },
      version: process.env.npm_package_version || 'unknown',
      requestId,
      ...(missingProdSecrets.length ? { missingProdSecrets } : {}),
    }

    return NextResponse.json(body, {
      status: ready ? 200 : 503,
      headers: { 'x-request-id': requestId },
    })
  } catch (error) {
    logger.error('health check error', { error: error instanceof Error ? error.message : String(error) }, request)
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
