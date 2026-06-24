import { prisma } from '@/lib/prisma'

export interface RecentFeedRate {
  merchant: string
  currency: string
  fxRateToBase: number
  fxSource: string
  fxDate: string
}

/**
 * Returns a list of recent authoritative feed rates, normalized for prompting.
 * Used to give the AI agent memory of real rates that were applied.
 */
export async function getRecentFeedRates(limit = 6): Promise<RecentFeedRate[]> {
  try {
    const lines = await prisma.journalLine.findMany({
      where: {
        fxSource: { startsWith: 'BANK_FEED' },
        fxRateToBase: { not: null },
      },
      include: {
        journalEntry: { select: { description: true, date: true } },
      },
      orderBy: { journalEntry: { date: 'desc' } },
      take: 40,
    })

    const seen = new Set<string>()
    const result: RecentFeedRate[] = []

    for (const l of lines) {
      const rawMerchant = (l.journalEntry.description || l.description || '').trim()
      if (!rawMerchant || l.fxRateToBase == null) continue

      // Normalize merchant a bit for deduping
      const merchant = rawMerchant.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().slice(0, 40)
      if (!merchant) continue

      const key = `${merchant}|${l.currency}`
      if (seen.has(key)) continue
      seen.add(key)

      result.push({
        merchant: rawMerchant,
        currency: (l.currency || 'EUR').toUpperCase(),
        fxRateToBase: Number(l.fxRateToBase),
        fxSource: l.fxSource || 'BANK_FEED',
        fxDate: l.fxDate ? l.fxDate.toISOString().slice(0, 10) : l.journalEntry.date.toISOString().slice(0, 10),
      })

      if (result.length >= limit) break
    }

    return result
  } catch {
    return []
  }
}

/**
 * Returns a compact string to inject into the LLM system prompt.
 */
export async function getRecentFeedRatesPromptText(limit = 6): Promise<string> {
  const rates = await getRecentFeedRates(limit)
  if (!rates.length) return ''

  const lines = rates.map(r =>
    `- ${r.merchant}: ${r.currency} @ ${r.fxRateToBase.toFixed(4)} (BANK_FEED ${r.fxDate})`
  )

  return [
    'Recent real bank/card feed rates (use these when the merchant matches, they are authoritative):',
    ...lines,
  ].join('\n')
}
