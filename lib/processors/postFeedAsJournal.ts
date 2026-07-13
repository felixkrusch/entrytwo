import { prisma } from '@/lib/prisma'
import { NormalizedProcessorTx, createProcessorJournalEntry } from './normalize'

/**
 * Given a FeedTransaction id (from Stripe or PayPal sync/webhook),
 * turn it into a proper journal entry using the shared processor logic.
 *
 * This is the recommended way to post processor data to the books.
 */
export async function postFeedTransactionAsJournal(
  feedTransactionId: string,
  opts: {
    settlementAccountCode: string
    feeAccountCode?: string
    counterAccountCode?: string
    branch?: string
  }
) {
  const ft = await prisma.feedTransaction.findUnique({
    where: { id: feedTransactionId },
    include: { connection: true },
  })
  if (!ft) throw new Error('FeedTransaction not found')

  const raw = (ft.rawData as Record<string, unknown>) || {}

  // Reconstruct a NormalizedProcessorTx from what we stored.
  // For Stripe balance transactions we store under raw.balance_transaction
  const isStripe = ft.connection?.provider === 'stripe'
  const isPayPal = ft.connection?.provider === 'paypal'

  let normalized: NormalizedProcessorTx

  const btRaw = (raw.balance_transaction as Record<string, unknown>) || null
  if (isStripe && btRaw) {
    const bt = btRaw
    normalized = {
      externalId: String(bt.id || ft.externalId),
      date: new Date(Number(bt.created || Date.now() / 1000) * 1000),
      description: String(bt.description || 'Stripe balance transaction'),
      merchant: (bt.source as any)?.billing_details?.name || null, // safe narrow access
      amount: Math.abs(Number(bt.amount || 0) / 100),
      currency: String(bt.currency || 'USD'),
      feeAmount: bt.fee ? Math.abs(Number(bt.fee) / 100) : undefined,
      feeCurrency: String(bt.currency || 'USD'),
      netAmount: bt.net ? Math.abs(Number(bt.net) / 100) : undefined,
      netCurrency: String(bt.currency || 'USD'),
      exchangeRateToBase: bt.exchange_rate ? Number(bt.exchange_rate) : null,
      fxSource: `BANK_FEED:stripe:${String(bt.id || ft.externalId)}`,
      fxDate: bt.created ? new Date(Number(bt.created) * 1000).toISOString().slice(0, 10) : undefined,
      type: 'charge',
      direction: Number(bt.amount || 0) > 0 ? 'in' : 'out',
      payoutId: (bt.source as any)?.payout || null,
      raw,
    }
  } else if (isPayPal) {
    interface PayPalAmount { value?: string; currency_code?: string }
    interface PayPalRaw {
      transaction_amount?: PayPalAmount
      fee_amount?: PayPalAmount
      net_amount?: PayPalAmount
    }
    const t = (raw.transaction as PayPalRaw) || (raw as PayPalRaw)
    const amt = parseFloat(t.transaction_amount?.value || String(ft.amount))
    const currency = String(t.transaction_amount?.currency_code || ft.currency).toUpperCase()

    normalized = {
      externalId: ft.externalId,
      date: ft.date,
      description: ft.description || 'PayPal transaction',
      merchant: ft.merchant,
      amount: Math.abs(amt),
      currency,
      feeAmount: t.fee_amount?.value ? Math.abs(parseFloat(t.fee_amount.value)) : undefined,
      feeCurrency: currency,
      netAmount: t.net_amount?.value ? Math.abs(parseFloat(t.net_amount.value)) : undefined,
      netCurrency: currency,
      exchangeRateToBase: ft.fxRateToBase ? Number(ft.fxRateToBase) : null,
      fxSource: `BANK_FEED:paypal:${ft.externalId}`,
      fxDate: ft.date.toISOString().slice(0, 10),
      type: 'charge',
      direction: Number(ft.amount) > 0 ? 'in' : 'out',
      raw,
    }
  } else {
    // Generic fallback
    normalized = {
      externalId: ft.externalId,
      date: ft.date,
      description: ft.description || 'Processor transaction',
      merchant: ft.merchant,
      amount: Number(ft.amount),
      currency: ft.currency,
      exchangeRateToBase: ft.fxRateToBase ? Number(ft.fxRateToBase) : null,
      fxSource: ft.fxRateToBase ? `BANK_FEED:${ft.connection?.provider || 'processor'}:${ft.externalId}` : undefined,
      fxDate: ft.date.toISOString().slice(0, 10),
      type: 'charge',
      direction: Number(ft.amount) > 0 ? 'in' : 'out',
      raw,
    }
  }

  // Force BANK_FEED prefix on fxSource if missing
  if (normalized.exchangeRateToBase && (!normalized.fxSource || !normalized.fxSource.startsWith('BANK_FEED'))) {
    normalized.fxSource = `BANK_FEED:${ft.connection?.provider || 'processor'}:${ft.externalId}`
  }

  const entry = await createProcessorJournalEntry(normalized, {
    connectionId: ft.connectionId,
    settlementAccountCode: opts.settlementAccountCode,
    feeAccountCode: opts.feeAccountCode,
    counterAccountCode: opts.counterAccountCode,
    branch: opts.branch,
  })

  // Mark the feed transaction as posted
  await prisma.feedTransaction.update({
    where: { id: ft.id },
    data: { status: 'posted', journalEntryId: entry.id },
  })

  return entry
}
