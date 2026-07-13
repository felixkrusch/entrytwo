import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { decryptCredentials } from '@/lib/encryption'
import { requireUser } from '@/lib/authz'
import {
  NormalizedProcessorTx,
  upsertFeedTransaction,
  createProcessorJournalEntry,
} from '@/lib/processors/normalize'
import { logger } from '@/lib/logger'

/**
 * Stripe sync using Balance Transactions (the correct authoritative source).
 * This replaces the old narrow /charges sync.
 */
async function syncStripe(connection: { id: string; credentials: string | null }) {
  // Prefer global .env key (recommended). Fall back to per-connection stored key only if present (legacy).
  let apiKey = process.env.STRIPE_SECRET_KEY
  if (!apiKey && connection.credentials) {
    try {
      const creds = decryptCredentials(connection.credentials) as Record<string, unknown> | null
      apiKey = typeof creds?.apiKey === 'string' ? creds.apiKey : undefined
    } catch {}
  }
  if (!apiKey) throw new Error('Stripe feed requires STRIPE_SECRET_KEY in .env')

  const since = Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 90 // last ~90 days
  let startingAfter: string | undefined
  let total = 0
  let imported = 0

  // Use Balance Transactions – this is what actually hit the Stripe balance.
  // It includes charges, refunds, payouts, fees, adjustments with proper exchange_rate.
  while (true) {
    const url = new URL('https://api.stripe.com/v1/balance_transactions')
    url.searchParams.set('limit', '100')
    url.searchParams.set('created[gte]', String(since))
    if (startingAfter) url.searchParams.set('starting_after', startingAfter)

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!res.ok) throw new Error(`Stripe API error: ${res.status}`)

    const data = await res.json()
    const batch: any[] = data.data || []

    for (const bt of batch) {
      total++
      const exists = await prisma.feedTransaction.findUnique({
        where: { connectionId_externalId: { connectionId: connection.id, externalId: bt.id } },
      })
      if (exists) continue

      const normalized: NormalizedProcessorTx = {
        externalId: bt.id,
        date: new Date(bt.created * 1000),
        description: bt.description || bt.reporting_category || 'Stripe balance transaction',
        merchant: bt.source?.billing_details?.name || bt.description || null,
        amount: Math.abs(bt.amount) / 100,
        currency: bt.currency,
        feeAmount: bt.fee ? Math.abs(bt.fee) / 100 : undefined,
        feeCurrency: bt.currency,
        netAmount: bt.net ? Math.abs(bt.net) / 100 : undefined,
        netCurrency: bt.currency,
        exchangeRateToBase: bt.exchange_rate ? Number(bt.exchange_rate) : null,
        fxSource: `BANK_FEED:stripe:${bt.id}`,
        fxDate: bt.created ? new Date(bt.created * 1000).toISOString().slice(0, 10) : undefined,
        type: bt.reporting_category === 'charge' ? 'charge' :
              bt.reporting_category === 'refund' ? 'refund' :
              bt.reporting_category === 'payout' ? 'payout' : 'adjustment',
        direction: bt.amount > 0 ? 'in' : 'out',
        payoutId: bt.source?.payout || null,
        raw: { balance_transaction: bt },
      }

      await upsertFeedTransaction(connection.id, normalized)
      imported++

      // Optional: auto-create simple journal for high-confidence payout/charge (disabled by default to respect lock)
      // Users can trigger via chat or future UI. We keep it as FeedTransaction for now.
    }

    if (!data.has_more) break
    startingAfter = batch[batch.length - 1]?.id
  }

  return { imported, total }
}

/**
 * PayPal sync – fixed version.
 * Uses reporting/transactions with proper date range + pagination.
 * Also pulls payouts when possible.
 */
async function syncPayPal(connection: { id: string; credentials: string | null }) {
  // Prefer global .env keys (recommended for PayPal feeds).
  // Only fall back to stored credentials for legacy setups.
  let clientId = process.env.PAYPAL_CLIENT_ID
  let secret = process.env.PAYPAL_SECRET

  if ((!clientId || !secret) && connection.credentials) {
    try {
      const creds = decryptCredentials(connection.credentials) as Record<string, unknown> | null
      clientId = clientId || (typeof creds?.clientId === 'string' ? creds.clientId : undefined) || (typeof creds?.PAYPAL_CLIENT_ID === 'string' ? creds.PAYPAL_CLIENT_ID : undefined)
      secret = secret || (typeof creds?.secret === 'string' ? creds.secret : undefined) || (typeof creds?.PAYPAL_SECRET === 'string' ? creds.PAYPAL_SECRET : undefined) || (typeof creds?.apiKey === 'string' ? creds.apiKey : undefined)
    } catch {}
  }

  if (!clientId || !secret) {
    throw new Error('PayPal feed requires PAYPAL_CLIENT_ID and PAYPAL_SECRET in .env')
  }

  // Obtain an access token using client credentials
  const auth = Buffer.from(`${clientId}:${secret}`).toString('base64')
  const tokenRes = await fetch('https://api.paypal.com/v1/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })
  if (!tokenRes.ok) throw new Error('Failed to obtain PayPal access token')
  const tokenData = await tokenRes.json()
  const token = tokenData.access_token
  if (!token) throw new Error('No access token for PayPal')

  // We just obtained a fresh access token via client credentials above.
  // No stored token is used for PayPal feeds.

  const now = new Date()
  const start = new Date(now.getTime() - 1000 * 60 * 60 * 24 * 90).toISOString() // ~90 days
  const end = now.toISOString()

  let page = 1
  let total = 0
  let imported = 0
  const pageSize = 100

  while (true) {
    const url = `https://api.paypal.com/v1/reporting/transactions?start_date=${start}&end_date=${end}&page_size=${pageSize}&page=${page}`

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error(`PayPal API error: ${res.status}`)

    const data = await res.json()
    const txs = data.transactions || []

    for (const t of txs) {
      total++
      const externalId = t.transaction_id || t.id
      if (!externalId) continue

      const exists = await prisma.feedTransaction.findUnique({
        where: { connectionId_externalId: { connectionId: connection.id, externalId } },
      })
      if (exists) continue

      const amount = Math.abs(parseFloat(t.transaction_amount?.value || t.amount?.value || '0'))
      const currency = (t.transaction_amount?.currency_code || t.amount?.currency_code || 'USD').toUpperCase()

      // PayPal sometimes reports separate fee and net; try to capture
      const fee = t.fee_amount ? Math.abs(parseFloat(t.fee_amount.value)) : undefined
      const net = t.net_amount ? Math.abs(parseFloat(t.net_amount.value)) : undefined

      // FX: PayPal reports conversion in some objects
      let fxRate: number | null = null
      if (t.transaction_info?.exchange_rate) fxRate = parseFloat(t.transaction_info.exchange_rate)
      if (t.exchange_rate) fxRate = parseFloat(t.exchange_rate)

      const normalized: NormalizedProcessorTx = {
        externalId,
        date: new Date(t.transaction_initiation_date || t.transaction_updated_date || Date.now()),
        description: t.transaction_note || t.transaction_subject || 'PayPal transaction',
        merchant: t.payer_info?.email_address || t.payer_info?.payer_name?.given_name || null,
        amount,
        currency,
        feeAmount: fee,
        feeCurrency: currency,
        netAmount: net,
        netCurrency: currency,
        exchangeRateToBase: fxRate,
        fxSource: `BANK_FEED:paypal:${externalId}`,
        fxDate: t.transaction_initiation_date ? t.transaction_initiation_date.slice(0, 10) : undefined,
        type: t.transaction_event_code?.includes('PAYOUT') ? 'payout' : 'charge',
        direction: (t.transaction_amount?.value || '0').startsWith('-') ? 'out' : 'in',
        raw: { transaction: t },
      }

      await upsertFeedTransaction(connection.id, normalized)
      imported++
    }

    if (txs.length < pageSize) break
    page++
  }

  // Also attempt to sync recent payouts (best effort)
  try {
    const payoutUrl = 'https://api.paypal.com/v1/payments/payouts'
    const pr = await fetch(payoutUrl, { headers: { Authorization: `Bearer ${token}` } })
    if (pr.ok) {
      const pdata = await pr.json()
      // PayPal payouts list is more involved; we log for now and rely on reporting/transactions above.
      // Full payout item sync can be added later without changing the shape.
    }
  } catch {
    // non-fatal
  }

  return { imported, total }
}

export async function POST(request: Request) {
  if (!await requireUser(['ADMIN'])) return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  try {
    const { connectionId } = await request.json()
    const connection = await prisma.bankConnection.findUnique({ where: { id: connectionId } })
    if (!connection) return NextResponse.json({ error: 'Connection not found' }, { status: 404 })

    let result: { imported: number; total: number } | null = null

    if (connection.provider === 'stripe') {
      result = await syncStripe(connection)
    } else if (connection.provider === 'paypal') {
      result = await syncPayPal(connection)
    } else {
      throw new Error(`Sync not implemented for provider: ${connection.provider}`)
    }

    await prisma.bankConnection.update({
      where: { id: connectionId },
      data: { lastSyncAt: new Date() },
    })

    return NextResponse.json({
      status: 'synced',
      lastSyncAt: new Date().toISOString(),
      imported: result?.imported || 0,
      total: result?.total || 0,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to sync'
    logger.error('Sync error', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
