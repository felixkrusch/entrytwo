import { prisma } from '@/lib/prisma'

export interface MerchantMemory {
  merchant: string
  accountCode?: string
  taxRateId?: string
  currency?: string
  fxRateToBase?: number
  fxSource?: string
  lastUsedDate?: string
}

/**
 * Very lightweight "memory" for the AI agent.
 * Looks at recent journal lines for a merchant (by description match) and returns
 * the most commonly/recently used categorization + tax + FX info.
 */
export async function getMerchantMemory(merchant: string): Promise<MerchantMemory | null> {
  if (!merchant) return null

  const needle = merchant.toLowerCase().slice(0, 30)

  try {
    const lines = await prisma.journalLine.findMany({
      where: {
        journalEntry: {
          description: { contains: needle, mode: 'insensitive' },
        },
      },
      include: {
        account: { select: { code: true } },
        taxRate: { select: { id: true } },
        journalEntry: { select: { date: true, description: true } },
      },
      orderBy: { journalEntry: { date: 'desc' } },
      take: 15,
    })

    if (!lines.length) return null

    // Pick the most recent line as "memory"
    const recent = lines[0]

    return {
      merchant,
      accountCode: recent.account?.code,
      taxRateId: recent.taxRate?.id,
      currency: recent.currency || undefined,
      fxRateToBase: recent.fxRateToBase ? Number(recent.fxRateToBase) : undefined,
      fxSource: recent.fxSource || undefined,
      lastUsedDate: recent.journalEntry.date.toISOString().slice(0, 10),
    }
  } catch {
    return null
  }
}

/**
 * Returns a compact memory block for the LLM system prompt.
 */
export async function getMerchantMemoryPrompt(merchant?: string): Promise<string> {
  if (!merchant) return ''
  const mem = await getMerchantMemory(merchant)
  if (!mem || !mem.accountCode) return ''

  const parts = [
    `For vendor "${mem.merchant}" the user previously used:`,
    `- Account: ${mem.accountCode}`,
  ]
  if (mem.taxRateId) parts.push(`- Tax rate id: ${mem.taxRateId}`)
  if (mem.currency && mem.fxRateToBase) {
    parts.push(`- Currency: ${mem.currency} @ ${mem.fxRateToBase} (source: ${mem.fxSource || 'previous'})`)
  }
  parts.push(`(last used ${mem.lastUsedDate})`)

  return parts.join('\n')
}
