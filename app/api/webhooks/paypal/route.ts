import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { upsertFeedTransaction, type NormalizedProcessorTx } from '@/lib/processors/normalize'
import { verifyPaypalSignature } from '@/lib/webhook'
import { getRequestId } from '@/lib/correlation'
import { logger } from '@/lib/logger'
import { enqueueJob } from '@/lib/jobs'

/**
 * Modern PayPal webhook handler.
 * Listens for the important events and records them as FeedTransaction with BANK_FEED:paypal:... markers.
 */
export async function POST(request: Request) {
  const requestId = getRequestId(request)
  const body = await request.text()
  const headers = {
    'paypal-cert-url': request.headers.get('paypal-cert-url'),
    'paypal-transmission-id': request.headers.get('paypal-transmission-id'),
    'paypal-transmission-time': request.headers.get('paypal-transmission-time'),
    'paypal-transmission-sig': request.headers.get('paypal-transmission-sig'),
    'paypal-auth-algo': request.headers.get('paypal-auth-algo'),
  }
  if (!await verifyPaypalSignature(body, headers)) return NextResponse.json({ error: 'Invalid PayPal signature', requestId }, { status: 401 })

  try {
    const event = JSON.parse(body)
    if (!event.id || !event.event_type) return NextResponse.json({ error: 'Invalid event payload', requestId }, { status: 400 })
    const stored = await prisma.webhookEvent.upsert({
      where: { provider_externalId: { provider: 'paypal', externalId: event.id } },
      create: { provider: 'paypal', externalId: event.id, eventType: event.event_type, payload: event },
      update: {},
    })
    const job = await enqueueJob('WEBHOOK_PAYPAL', `webhook:paypal:${event.id}`, { webhookEventId: stored.id })
    const res = NextResponse.json({ received: true, jobId: job.id, requestId }, { status: 202 })
    res.headers.set('x-request-id', requestId)
    return res
  } catch (e) {
    logger.error('PayPal webhook error', { error: e instanceof Error ? e.message : String(e) }, request)
  }

  const res = NextResponse.json({ received: true, requestId })
  res.headers.set('x-request-id', requestId)
  return res
}

export async function processPayPalWebhook(webhookEventId: string) {
  const stored = await prisma.webhookEvent.update({ where: { id: webhookEventId }, data: { status: 'PROCESSING', attempts: { increment: 1 }, lastError: null } })
  try {
    await handlePayPalEvent(stored.payload)
    await prisma.webhookEvent.update({ where: { id: stored.id }, data: { status: 'SUCCEEDED', processedAt: new Date() } })
  } catch (error) {
    await prisma.webhookEvent.update({ where: { id: stored.id }, data: { status: 'FAILED', lastError: error instanceof Error ? error.message.slice(0, 2000) : 'Unknown error' } })
    throw error
  }
}

async function handlePayPalEvent(event: any) {
  const type: string = event.event_type || ''
  const resource = event.resource || {}

  const connection = await prisma.bankConnection.findFirst({ where: { provider: 'paypal' } })
  if (!connection) return

  const externalId = resource.id || resource.transaction_id || event.id
  if (!externalId) return

  const amountObj = resource.amount || resource.seller_receivable_breakdown?.gross_amount || {}
  const amount = Math.abs(parseFloat(amountObj.value || '0'))
  const currency = (amountObj.currency_code || 'USD').toUpperCase()

  let fxRate: number | null = null
  if (resource.exchange_rate) fxRate = parseFloat(resource.exchange_rate)
  if (resource.seller_receivable_breakdown?.exchange_rate) {
    fxRate = parseFloat(resource.seller_receivable_breakdown.exchange_rate)
  }

  if (type.includes('PAYMENT.CAPTURE') || type.includes('PAYMENT.SALE')) {
    const chargeTx: NormalizedProcessorTx = {
      externalId,
      date: new Date(resource.create_time || Date.now()),
      description: resource.description || type,
      merchant: resource.payer?.payer_info?.email_address || null,
      amount,
      currency,
      exchangeRateToBase: fxRate,
      fxSource: `BANK_FEED:paypal:${externalId}`,
      fxDate: resource.create_time ? resource.create_time.slice(0, 10) : undefined,
      type: 'charge',
      direction: 'in',
      raw: { type, resource },
    }
    await upsertFeedTransaction(connection.id, chargeTx)
  }

  if (type.includes('REFUND')) {
    const refundTx: NormalizedProcessorTx = {
      externalId,
      date: new Date(resource.create_time || Date.now()),
      description: resource.description || 'PayPal refund',
      amount,
      currency,
      exchangeRateToBase: fxRate,
      fxSource: `BANK_FEED:paypal:${externalId}`,
      type: 'refund',
      direction: 'out',
      raw: { type, resource },
    }
    await upsertFeedTransaction(connection.id, refundTx)
  }

  if (type.includes('DISPUTE')) {
    const disputeTx: NormalizedProcessorTx = {
      externalId,
      date: new Date(resource.create_time || Date.now()),
      description: resource.reason || 'PayPal dispute',
      amount,
      currency,
      type: 'dispute',
      direction: (Number(amount) > 0) ? 'in' : 'out',
      raw: { type, resource },
    }
    await upsertFeedTransaction(connection.id, disputeTx)
  }

  if (type.includes('PAYOUTS-ITEM')) {
    const payoutTx: NormalizedProcessorTx = {
      externalId,
      date: new Date(resource.payout_item?.sent_date || Date.now()),
      description: 'PayPal payout',
      amount,
      currency,
      type: 'payout',
      direction: 'out',
      raw: { type, resource },
    }
    await upsertFeedTransaction(connection.id, payoutTx)
  }
}
