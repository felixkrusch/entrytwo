import { describe, expect, it } from 'vitest'
import { calculateFxBalance } from '../fxBalance'

describe('FX-aware journal balance', () => {
  it('balances 30 USD against 27.63 EUR at 0.921 EUR per USD', () => {
    const result = calculateFxBalance([
      { debit: 30, credit: 0, currency: 'USD', fxRateToBase: 0.921 },
      { debit: 0, credit: 27.63, currency: 'EUR' },
    ], 'EUR')

    expect(result).toMatchObject({ debitBase: 27.63, creditBase: 27.63, difference: 0, balanced: true })
  })

  it('rounds each converted journal line to base-currency cents', () => {
    const result = calculateFxBalance([
      { debit: 10, currency: 'USD', fxRateToBase: 0.9214 },
      { debit: 20, currency: 'USD', fxRateToBase: 0.9214 },
      { credit: 27.64, currency: 'EUR' },
    ], 'EUR')

    expect(result).toMatchObject({ debitBase: 27.64, creditBase: 27.64, balanced: true })
  })

  it('never treats a missing foreign rate as 1:1', () => {
    const result = calculateFxBalance([
      { debit: 30, currency: 'USD' },
      { credit: 30, currency: 'EUR' },
    ], 'EUR')

    expect(result.balanced).toBe(false)
    expect(result.missingRates).toEqual(['USD'])
  })

  it('uses the configured base currency rather than assuming EUR', () => {
    const result = calculateFxBalance([
      { debit: 30, currency: 'EUR', fxRateToBase: 0.8 },
      { credit: 24, currency: 'GBP' },
    ], 'GBP')

    expect(result).toMatchObject({ debitBase: 24, creditBase: 24, balanced: true })
  })
})
