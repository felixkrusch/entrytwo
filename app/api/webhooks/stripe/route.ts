import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyStripeSignature } from '@/lib/webhook'
import { upsertFeedTransaction } from '@/lib/processors/normalize'
import type { NormalizedProcessorTx } from '@/lib/processors/normalize'
import { enqueueJob } from '@/lib/jobs'

/**
 * Modern Stripe webhook handler.
 * Handles the important events and creates proper FeedTransaction + (optionally) journal entries.
 * All processor-derived FX is marked BANK_FEED:stripe:...
 */
export async function POST(request: Request) {
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Stripe webhook is not configured' }, { status: 503 })
  }
  const signature = request.headers.get('stripe-signature')
  const body = await request.text()

  if (!verifyStripeSignature(body, signature, process.env.STRIPE_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  try {
    const event = JSON.parse(body)
    if (!event.id || !event.type) return NextResponse.json({ error: 'Invalid event payload' }, { status: 400 })
    const stored = await prisma.webhookEvent.upsert({
      where: { provider_externalId: { provider: 'stripe', externalId: event.id } },
      create: { provider: 'stripe', externalId: event.id, eventType: event.type, payload: event },
      update: {},
    })
    const job = await enqueueJob('WEBHOOK_STRIPE', `webhook:stripe:${event.id}`, { webhookEventId: stored.id })
    return NextResponse.json({ received: true, jobId: job.id }, { status: 202 })
  } catch (e) {
    console.error('Stripe webhook processing error:', e)
  }

  return NextResponse.json({ received: true })
}

export async function processStripeWebhook(webhookEventId: string) {
  const stored = await prisma.webhookEvent.update({ where: { id: webhookEventId }, data: { status: 'PROCESSING', attempts: { increment: 1 }, lastError: null } })
  try {
    await handleStripeEvent(stored.payload)
    await prisma.webhookEvent.update({ where: { id: stored.id }, data: { status: 'SUCCEEDED', processedAt: new Date() } })
  } catch (error) {
    await prisma.webhookEvent.update({ where: { id: stored.id }, data: { status: 'FAILED', lastError: error instanceof Error ? error.message.slice(0, 2000) : 'Unknown error' } })
    throw error
  }
}

async function handleStripeEvent(event: any) {
  const type: string = event.type
  const obj = event.data?.object || {}

  const connection = await prisma.bankConnection.findFirst({ where: { provider: 'stripe' } })
  if (!connection) {
    // Still handle invoice payment metadata even without a feed connection
    if (type === 'payment_intent.succeeded') {
      const invoiceId = obj.metadata?.invoiceId
      if (invoiceId) {
        await prisma.invoice.update({
          where: { id: invoiceId },
          data: { status: 'PAID', paidDate: new Date(), stripeInvoiceId: obj.id },
        })
      }
    }
    return
  }

  // Always try to record the raw event as a FeedTransaction for audit/reconciliation.
  const externalId = obj.id || event.id
  const amount = (obj.amount ?? obj.amount_total ?? 0) / 100
  const currency = (obj.currency || 'usd').toUpperCase()

  const normalizedBase = {
    externalId,
    date: new Date((obj.created || Date.now() / 1000) * 1000),
    description: obj.description || obj.statement_descriptor || type,
    merchant: obj.billing_details?.name || obj.description || null,
    amount: Math.abs(amount),
    currency,
    raw: { type, ...obj },
  }

  // Specific event handling - construct proper NormalizedProcessorTx (no any casts)
  if (type === 'charge.succeeded' || type === 'payment_intent.succeeded') {
    const chargeTx: NormalizedProcessorTx = {
      externalId,
      date: new Date((obj.created || Date.now() / 1000) * 1000),
      description: obj.description || obj.statement_descriptor || type,
      merchant: obj.billing_details?.name || obj.description || null,
      amount: Math.abs(amount),
      currency,
      type: 'charge',
      direction: 'in',
      raw: { type, ...obj },
    }
    await upsertFeedTransaction(connection.id, chargeTx)
  }

  if (type === 'charge.refunded' || type === 'refund.created') {
    const refundTx: NormalizedProcessorTx = {
      externalId,
      date: new Date((obj.created || Date.now() / 1000) * 1000),
      description: obj.description || 'Stripe refund',
      amount: Math.abs(amount),
      currency,
      type: 'refund',
      direction: 'out',
      raw: { type, ...obj },
    }
    await upsertFeedTransaction(connection.id, refundTx)
  }

  if (type === 'charge.dispute.created' || type === 'charge.dispute.closed') {
    const disputeTx: NormalizedProcessorTx = {
      externalId,
      date: new Date((obj.created || Date.now() / 1000) * 1000),
      description: obj.reason || 'Stripe dispute',
      amount: Math.abs(amount),
      currency,
      type: 'dispute',
      direction: (Number(amount) > 0) ? 'in' : 'out',
      raw: { type, ...obj },
    }
    await upsertFeedTransaction(connection.id, disputeTx)
  }

  if (type === 'payout.paid' || type === 'payout.created') {
    const payout = obj
    const payoutTx: NormalizedProcessorTx = {
      externalId: payout.id,
      date: new Date((payout.arrival_date || payout.created || Date.now() / 1000) * 1000),
      description: `Stripe payout ${payout.id}`,
      amount: Math.abs((payout.amount || 0) / 100),
      currency: (payout.currency || 'usd').toUpperCase(),
      netAmount: Math.abs((payout.amount || 0) / 100),
      type: 'payout',
      direction: 'in',
      raw: { payout },
    }
    await upsertFeedTransaction(connection.id, payoutTx)
  }

  // Invoice payment journal (existing simple path – kept for backward compat)
  if (type === 'payment_intent.succeeded') {
    const invoiceId = obj.metadata?.invoiceId
    if (invoiceId) {
      await prisma.invoice.update({
        where: { id: invoiceId },
        data: { status: 'PAID', paidDate: new Date(), stripeInvoiceId: obj.id },
      })
      // Note: the rich journal for the actual processor movement is created via sync or chat.
    }
  }
}
