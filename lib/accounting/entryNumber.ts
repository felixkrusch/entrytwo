import { prisma } from '@/lib/prisma'

/**
 * Compute the next human-readable journal entry reference for a given year,
 * in the form JE-YYYY-NNNN (per-year sequential, zero-padded to 4 digits).
 *
 * Reads the highest existing number for that year and increments it.
 * Falls back to 1 when no entries exist for the year yet.
 */
export async function nextEntryNumber(date: Date): Promise<string> {
  const year = date.getUTCFullYear()
  const prefix = `JE-${year}-`

  const latest = await prisma.journalEntry.findFirst({
    where: { entryNumber: { startsWith: prefix } },
    orderBy: { entryNumber: 'desc' },
    select: { entryNumber: true },
  })

  let next = 1
  if (latest?.entryNumber) {
    const suffix = latest.entryNumber.slice(prefix.length)
    const parsed = parseInt(suffix, 10)
    if (!isNaN(parsed)) next = parsed + 1
  }

  return `${prefix}${String(next).padStart(4, '0')}`
}
