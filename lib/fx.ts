import { prisma } from '@/lib/prisma'
import { isAuthoritativeBankFeed, normalizeToProvisional } from '@/lib/fxSources'

// Very lightweight FX helper for Phase 0 multi-currency.
// Priority:
// 1. EUR → always 1
// 2. If we have a journal line for the currency with fxRateToBase on/near the date → use the most recent one
// 3. Fallback: try ECB Statistical Data Warehouse daily eurofxref (best effort, cached in memory for the process)
// 4. Final fallback: return null (caller should ask user or use MANUAL)

const ECB_DAILY = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml'

let ecbCache: { date: string; rates: Record<string, number> } | null = null
let ecbCacheTime = 0
const CACHE_TTL = 1000 * 60 * 60 // 1 hour

export type ProvisionalFxQuote = {
  currency: string
  date: string
  fxRateToBase: number
  fxSource: string
}

export async function getProvisionalFxQuote(currency: string, date?: string | Date): Promise<ProvisionalFxQuote | null> {
  const cur = (currency || 'EUR').toUpperCase()
  const targetDate = date ? new Date(date) : new Date()
  const iso = targetDate.toISOString().slice(0, 10)
  if (cur === 'EUR') return { currency: cur, date: iso, fxRateToBase: 1, fxSource: 'BASE' }

  const quote = await getFxQuoteToBase(cur, targetDate)
  if (!quote) return null

  return {
    currency: cur,
    date: iso,
    fxRateToBase: quote.fxRateToBase,
    // Reusing any prior rate is only an estimate for this transaction, including a prior bank rate.
    fxSource: isAuthoritativeBankFeed(quote.fxSource)
      ? 'HISTORICAL_FEED_PROVISIONAL'
      : normalizeToProvisional(quote.fxSource),
  }
}

async function getFxQuoteToBase(currency: string, date?: string | Date): Promise<{ fxRateToBase: number; fxSource: string } | null> {
  const cur = (currency || 'EUR').toUpperCase()
  if (cur === 'EUR') return { fxRateToBase: 1, fxSource: 'BASE' }

  const targetDate = date ? new Date(date) : new Date()

  // 1. Look for a recent journal line that already carries an authoritative rate for this currency
  try {
    const since = new Date(targetDate.getTime() - 1000 * 60 * 60 * 24 * 45) // last ~45 days
    const lines = await prisma.journalLine.findMany({
      where: {
        currency: cur,
        fxRateToBase: { not: null },
        journalEntry: {
          date: { gte: since, lte: targetDate },
        },
      },
      orderBy: { journalEntry: { date: 'desc' } },
      take: 5,
    })

    if (lines.length > 0) {
      const best = lines[0]
      const rate = best.fxRateToBase != null ? Number(best.fxRateToBase) : null
      if (rate && isFinite(rate) && rate > 0) {
        return { fxRateToBase: rate, fxSource: best.fxSource || 'HISTORICAL_RATE' }
      }
    }
  } catch {
    // ignore and fall through
  }

  // 2. Try ECB daily reference rates (EUR base)
  try {
    const now = Date.now()
    if (!ecbCache || now - ecbCacheTime > CACHE_TTL) {
      const res = await fetch(ECB_DAILY, { next: { revalidate: 3600 } } as unknown as RequestInit)
      if (res.ok) {
        const xml = await res.text()
        const rates: Record<string, number> = {}

        // Very small parser for <Cube currency="USD" rate="1.0743"/>
        const re = /<Cube\s+currency="([A-Z]{3})"\s+rate="([0-9.]+)"/g
        let m: RegExpExecArray | null
        while ((m = re.exec(xml)) !== null) {
          const c = m[1]
          const r = parseFloat(m[2])
          if (c && isFinite(r)) rates[c] = r
        }

        // ECB gives EUR as base, so rate is "EUR per 1 foreign"
        // For us fxRateToBase (base/foreign) when base=EUR is simply the ECB rate for USD etc.
        // Example: if ECB says USD 1.0743 → 1 USD = 1.0743? Wait, actually ECB is "1 EUR = x foreign"
        // ECB eurofxref-daily is: 1 EUR buys how many foreign units.
        // For our fxRateToBase = baseAmount / foreignAmount
        // If we have a USD invoice of 120, and ECB says 1 EUR = 1.08 USD, then 120 USD costs 120 / 1.08 ≈ 111.11 EUR
        // So fxRateToBase (EUR per USD) = 1 / ECB_USD_rate
        ecbCache = { date: new Date().toISOString().slice(0, 10), rates }
        ecbCacheTime = now
      }
    }

    if (ecbCache && ecbCache.rates[cur]) {
      const ecbForeignPerEur = ecbCache.rates[cur] // e.g. 1.08 for USD
      if (ecbForeignPerEur > 0) {
        return { fxRateToBase: 1 / ecbForeignPerEur, fxSource: 'ECB_PROVISIONAL' }
      }
    }
  } catch {
    // network or parse issue → fall through to null
  }

  return null
}

export async function getFxRateToBase(currency: string, date?: string | Date): Promise<number | null> {
  return (await getFxQuoteToBase(currency, date))?.fxRateToBase ?? null
}

// Convenience: given foreign amount + currency + optional date, return { baseAmount, fxRateToBase, fxSource, fxDate }
export async function convertToBase(
  foreignAmount: number,
  currency: string,
  date?: string | Date
): Promise<{ baseAmount: number; fxRateToBase: number | null; fxSource: string; fxDate: string }> {
  const cur = (currency || 'EUR').toUpperCase()
  const d = date ? new Date(date) : new Date()
  const iso = d.toISOString().slice(0, 10)

  if (cur === 'EUR') {
    return { baseAmount: foreignAmount, fxRateToBase: 1, fxSource: 'ECB', fxDate: iso }
  }

  const quote = await getProvisionalFxQuote(cur, d)
  if (quote) {
    return {
      baseAmount: Math.round(foreignAmount * quote.fxRateToBase * 100) / 100,
      fxRateToBase: quote.fxRateToBase,
      fxSource: quote.fxSource,
      fxDate: iso,
    }
  }

  // No rate available. NaN prevents callers from silently treating this as 1:1.
  return {
    baseAmount: Number.NaN,
    fxRateToBase: null,
    fxSource: 'MANUAL',
    fxDate: iso,
  }
}
