import { prisma } from '@/lib/prisma'

export interface MerchantMemory {
  merchant: string
  accountCode?: string
  taxRateId?: string
  currency?: string
  fxRateToBase?: number
  fxSource?: string
  lastUsedDate?: string
  region?: string // full ISO 3166-2 when we have it, e.g. "CA-ON"
}

/**
 * Enhanced merchant memory lookup.
 * Keys on "merchant + province/region" when region is provided.
 * Falls back to merchant-only if no strong region match.
 */
export async function getMerchantMemory(merchant: string, region?: string): Promise<MerchantMemory | null> {
  if (!merchant) return null

  const needle = merchant.toLowerCase().slice(0, 30)
  const targetRegion = (region || '').toUpperCase()

  try {
    const lines = await prisma.journalLine.findMany({
      where: {
        journalEntry: {
          description: { contains: needle, mode: 'insensitive' },
        },
      },
      include: {
        account: { select: { code: true } },
        taxRate: { select: { id: true, jurisdiction: true } },
        journalEntry: { select: { date: true, description: true } },
      },
      orderBy: { journalEntry: { date: 'desc' } },
      take: 20,
    })

    if (!lines.length) return null

    // Prefer lines whose tax jurisdiction matches the current region (full ISO like CA-ON)
    let best = lines[0]
    if (targetRegion) {
      const regionMatch = lines.find(l => (l.taxRate?.jurisdiction || '').toUpperCase() === targetRegion)
      if (regionMatch) best = regionMatch
    }

    return {
      merchant,
      accountCode: best.account?.code,
      taxRateId: best.taxRate?.id,
      currency: best.currency || undefined,
      fxRateToBase: best.fxRateToBase ? Number(best.fxRateToBase) : undefined,
      fxSource: best.fxSource || undefined,
      lastUsedDate: best.journalEntry.date.toISOString().slice(0, 10),
      region: best.taxRate?.jurisdiction || undefined,
    }
  } catch {
    return null
  }
}

/**
 * Returns a compact memory block for the LLM system prompt.
 * Now includes region context when available.
 */
export async function getMerchantMemoryPrompt(merchant?: string, region?: string): Promise<string> {
  if (!merchant) return ''
  const mem = await getMerchantMemory(merchant, region)
  if (!mem || !mem.accountCode) return ''

  const regionNote = mem.region ? ` (in ${mem.region})` : ''
  const parts = [
    `For vendor "${mem.merchant}"${regionNote} the user previously used:`,
    `- Account: ${mem.accountCode}`,
  ]
  if (mem.taxRateId) parts.push(`- Tax rate id: ${mem.taxRateId}`)
  if (mem.currency && mem.fxRateToBase) {
    parts.push(`- Currency: ${mem.currency} @ ${mem.fxRateToBase} (source: ${mem.fxSource || 'previous'})`)
  }
  parts.push(`(last used ${mem.lastUsedDate})`)

  return parts.join('\n')
}
