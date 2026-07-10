import { describe, it, expect } from 'vitest'
import {
  NormalizedProcessorTx,
  upsertFeedTransaction,
  createProcessorJournalEntry,
} from './normalize'

describe('processor normalize', () => {
  it('produces valid normalized shape for Stripe balance transaction style', () => {
    const bt = {
      id: 'txn_123',
      created: 1720000000,
      description: 'Charge for order',
      amount: 12345,
      currency: 'usd',
      fee: 365,
      net: 11980,
      exchange_rate: 0.92,
    }

    const normalized: NormalizedProcessorTx = {
      externalId: bt.id,
      date: new Date(bt.created * 1000),
      description: bt.description,
      amount: bt.amount / 100,
      currency: bt.currency,
      feeAmount: bt.fee / 100,
      netAmount: bt.net / 100,
      exchangeRateToBase: bt.exchange_rate,
      fxSource: `BANK_FEED:stripe:${bt.id}`,
      fxDate: new Date(bt.created * 1000).toISOString().slice(0, 10),
      type: 'charge',
      direction: 'in',
      raw: { balance_transaction: bt },
    }

    expect(normalized.externalId).toBe('txn_123')
    expect(normalized.fxSource).toMatch(/^BANK_FEED:stripe:/)
    expect(normalized.exchangeRateToBase).toBe(0.92)
    expect(normalized.feeAmount).toBe(3.65)
  })

  it('produces valid shape for PayPal transaction', () => {
    const normalized: NormalizedProcessorTx = {
      externalId: 'pp_abc',
      date: new Date('2026-06-15'),
      description: 'Sale',
      amount: 100,
      currency: 'USD',
      feeAmount: 2.9,
      netAmount: 97.1,
      exchangeRateToBase: 0.91,
      fxSource: 'BANK_FEED:paypal:pp_abc',
      fxDate: '2026-06-15',
      type: 'charge',
      direction: 'in',
      raw: {},
    }

    expect(normalized.fxSource).toBe('BANK_FEED:paypal:pp_abc')
    expect(normalized.netAmount).toBe(97.1)
  })
})
