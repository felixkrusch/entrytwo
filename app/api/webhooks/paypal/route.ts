import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { upsertFeedTransaction, type NormalizedProcessorTx } from '@/lib/processors/normalize'

/**
 * Modern PayPal webhook handler.
 * Listens for the important events and records them as FeedTransaction with BANK_FEED:paypal:... markers.
 */
export async function POST(request: Request) {
  const body = await request.text()

  // PayPal signature verification is still light in this codebase.
  // In production we should call verifyPaypalSignature.
  // For now we accept and process (same policy as before for dev).

  try {
    const event = JSON.parse(body)
    await handlePayPalEvent(event)
  } catch (e) {
    console.error('PayPal webhook error:', e)
  }

  return NextResponse.json({ received: true })
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
