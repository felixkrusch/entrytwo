import { prisma } from '@/lib/prisma'

/**
 * Look for a recent authoritative BANK_FEED rate for a given merchant/vendor name.
 * Returns the fx metadata from the most recent matching feed line if found.
 */
export async function findRecentBankFeedRateForMerchant(merchantLower: string) {
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

    const needle = merchantLower.toLowerCase()

    for (const line of lines) {
      const desc = (line.journalEntry.description || '').toLowerCase()
      const lineDesc = (line.description || '').toLowerCase()
      if (desc.includes(needle) || lineDesc.includes(needle)) {
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
