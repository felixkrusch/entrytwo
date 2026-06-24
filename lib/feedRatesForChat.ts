import { prisma } from '@/lib/prisma'

export async function getRecentFeedRatesForPrompt(limit = 8) {
  try {
    const lines = await prisma.journalLine.findMany({
      where: { fxSource: { startsWith: 'BANK_FEED' } },
      include: {
        journalEntry: { select: { description: true, date: true } },
      },
      orderBy: { journalEntry: { date: 'desc' } },
      take: 50,
    })

    const seen = new Set<string>()
    const result: string[] = []

    for (const l of lines) {
      const merchant = (l.journalEntry.description || l.description || '').trim()
      if (!merchant) continue
      const key = `${merchant}|${l.currency}|${l.fxRateToBase}`
      if (seen.has(key)) continue
      seen.add(key)

      const rate = l.fxRateToBase ? Number(l.fxRateToBase).toFixed(4) : '?'
      const d = l.journalEntry.date.toISOString().slice(0, 10)
      result.push(`${merchant} → ${l.currency} @ ${rate} (BANK_FEED ${d})`)
      if (result.length >= limit) break
    }

    return result
  } catch {
    return []
  }
}
