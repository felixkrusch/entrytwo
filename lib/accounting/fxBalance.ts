export type FxBalanceLine = {
  debit?: number | string | null
  credit?: number | string | null
  currency?: string | null
  fxRateToBase?: number | string | null
}

export type FxBalance = {
  debitBase: number
  creditBase: number
  difference: number
  balanced: boolean
  missingRates: string[]
}

const toCents = (amount: number) => Math.round((amount + Number.EPSILON) * 100)

export function calculateFxBalance(lines: FxBalanceLine[], baseCurrency: string): FxBalance {
  const base = baseCurrency.trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(base)) throw new Error('A valid configured base currency is required')
  let debitCents = 0
  let creditCents = 0
  const missingRates = new Set<string>()

  for (const line of lines) {
    const currency = (line.currency || base).toUpperCase()
    const rate = currency === base ? 1 : Number(line.fxRateToBase)
    if (!Number.isFinite(rate) || rate <= 0) {
      missingRates.add(currency)
      continue
    }

    // Accounting balances in base-currency cents, so round each converted line
    // before summing rather than comparing nominal amounts across currencies.
    debitCents += toCents((Number(line.debit) || 0) * rate)
    creditCents += toCents((Number(line.credit) || 0) * rate)
  }

  const debitBase = debitCents / 100
  const creditBase = creditCents / 100
  const difference = (debitCents - creditCents) / 100
  return {
    debitBase,
    creditBase,
    difference,
    balanced: missingRates.size === 0 && debitCents === creditCents && debitCents > 0,
    missingRates: Array.from(missingRates),
  }
}
