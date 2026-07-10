import { prisma } from '@/lib/prisma'

// Merchant normalization for common variations
function normalizeMerchantForLookup(name: string): string[] {
  const variants = [name.toLowerCase()]
  const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, '')
  const patterns: Record<string, string[]> = {
    vercel: ['vercel', 'vercelcharges'],
    stripe: ['stripe', 'stripecharges'],
    paypal: ['paypal'],
    github: ['github', 'github.com'],
    aws: ['amazon web services', 'aws', 'amzn'],
  }
  for (const [, pats] of Object.entries(patterns)) {
    if (pats.some(p => normalized.includes(p))) variants.push(...pats)
  }
  return [...new Set(variants)]
}

// Date proximity check (±1 day)
function datesMatchOrNear(d1: string, d2: string): boolean {
  if (!d1 || !d2) return false
  const t1 = new Date(d1).getTime(), t2 = new Date(d2).getTime()
  return !isNaN(t1) && !isNaN(t2) && Math.abs(t1 - t2) <= 24 * 60 * 60 * 1000
}

/**
 * Look for a recent authoritative BANK_FEED rate for a given merchant/vendor name.
 * Optional invoiceDate can be provided for stricter matching (exact match or ±1 day).
 * Returns the fx metadata from the most recent matching feed line if found.
 */
export async function findRecentBankFeedRateForMerchant(merchantLower: string, invoiceDate?: string) {
  if (!merchantLower) return null
  try {
    const since = new Date(Date.now() - 1000 * 60 * 60 * 24 * 90) // last ~90 days
    const lines = await prisma.journalLine.findMany({
      where: {
        fxSource: { startsWith: 'BANK_FEED' },
        journalEntry: {
          date: { gte: since },
        },
      },
      orderBy: [
        // Prefer explicit statement sources when multiple candidates exist
        { fxSource: 'desc' }, // 'BANK_FEED:statement:...' sorts after generic BANK_FEED
        { journalEntry: { date: 'desc' } },
      ],
      include: {
        journalEntry: { select: { description: true, date: true } },
      },
      take: 80,
    })

    const variants = normalizeMerchantForLookup(merchantLower)

    for (const line of lines) {
      const desc = (line.journalEntry.description || '').toLowerCase()
      const lineDesc = (line.description || '').toLowerCase()
      const dateMatches = invoiceDate 
        ? datesMatchOrNear(invoiceDate, line.journalEntry.date.toISOString().slice(0, 10))
        : true
      
      if (variants.some(v => desc.includes(v) || lineDesc.includes(v)) && dateMatches) {
        if (line.fxRateToBase != null && line.currency && line.fxDate) {
          // IMPORTANT: returned rates from past feeds are for REFERENCE only for new entries.
          // Callers must treat the result as non-authoritative (provisional) unless the current
          // context is literally the same statement being processed right now.
          return {
            fxRateToBase: Number(line.fxRateToBase),
            fxSource: 'PROVISIONAL', // never re-emit as BANK_FEED for a new entry
            fxDate: line.fxDate.toISOString().slice(0, 10),
            currency: (line.currency || 'EUR').toUpperCase(),
          }
        }
      }

      // Fallback: most recent statement rate is still only reference for new entries.
      const statementLine = lines.find(l =>
        (l.fxSource || '').startsWith('BANK_FEED:statement') &&
        l.fxRateToBase != null && l.currency && l.fxDate
      )
      if (statementLine && statementLine.fxDate) {
        return {
          fxRateToBase: Number(statementLine.fxRateToBase),
          fxSource: 'PROVISIONAL',
          fxDate: statementLine.fxDate.toISOString().slice(0, 10),
          currency: (statementLine.currency || 'EUR').toUpperCase(),
        }
      }
    }
  } catch {
    // non-fatal
  }
  return null
}