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
      include: {
        journalEntry: { select: { description: true, date: true } },
      },
      orderBy: { journalEntry: { date: 'desc' } },
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
          return {
            fxRateToBase: Number(line.fxRateToBase),
            fxSource: line.fxSource || 'BANK_FEED',
            fxDate: line.fxDate.toISOString().slice(0, 10),
            currency: (line.currency || 'EUR').toUpperCase(),
          }
        }
      }
    }
  } catch {
    // non-fatal
  }
  return null
}