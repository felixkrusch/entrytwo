#!/usr/bin/env tsx
/**
 * One-off backfill script.
 *
 * Assigns new `createdAt` timestamps to existing JournalEntry rows that have
 * entryNumber like "JE-2026-XXXX".
 *
 * The timestamps are assigned "random in order of the JE numbers":
 * - Sort entries by entryNumber ascending (JE-2026-0001 first).
 * - Assign createdAt going backwards from the provided "now".
 * - Each previous entry gets an earlier timestamp with a random delta.
 *
 * This makes ORDER BY date DESC, createdAt DESC stable and chronological
 * within the same business day, while respecting the human entry number sequence.
 *
 * Usage:
 *   npx tsx scripts/backfill-journal-createdat.ts            # dry run (prints what would change)
 *   npx tsx scripts/backfill-journal-createdat.ts --execute  # actually update
 */

import { prisma } from '../lib/prisma'

const NOW = new Date('2026-07-06T23:43:20+02:00')

// Random delta between entries: 10 minutes to 4 hours
const MIN_DELTA_MS = 10 * 60 * 1000
const MAX_DELTA_MS = 4 * 60 * 60 * 1000

function randomDelta() {
  return MIN_DELTA_MS + Math.random() * (MAX_DELTA_MS - MIN_DELTA_MS)
}

async function main() {
  const execute = process.argv.includes('--execute')

  console.log('Backfill JournalEntry.createdAt for JE-2026- entries')
  console.log('Base time (now):', NOW.toISOString())
  console.log('Mode:', execute ? 'EXECUTE (will write to DB)' : 'DRY RUN (no changes)')

  const entries = await prisma.journalEntry.findMany({
    where: {
      entryNumber: { startsWith: 'JE-2026-' },
    },
    select: {
      id: true,
      entryNumber: true,
      date: true,
      createdAt: true,
      description: true,
    },
  })

  if (entries.length === 0) {
    console.log('No JE-2026- entries found. Nothing to do.')
    return
  }

  // Sort by entryNumber ascending (0001, 0002, ...). This is the "order of the numbers".
  entries.sort((a, b) => {
    const na = a.entryNumber ? parseInt(a.entryNumber.slice(8), 10) : 0
    const nb = b.entryNumber ? parseInt(b.entryNumber.slice(8), 10) : 0
    return na - nb
  })

  // We want higher entry numbers to have later createdAt.
  // So we walk from the end (highest number) backwards in time.
  let current = new Date(NOW.getTime())

  const updates: Array<{ id: string; entryNumber: string | null; oldCreatedAt: Date; newCreatedAt: Date }> = []

  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]

    const newCreatedAt = new Date(current.getTime())

    updates.push({
      id: e.id,
      entryNumber: e.entryNumber,
      oldCreatedAt: e.createdAt,
      newCreatedAt,
    })

    // Move further into the past for the next (lower) entry number
    current = new Date(current.getTime() - randomDelta())
  }

  // Reverse so we print in ascending JE order
  updates.reverse()

  console.log(`\nFound ${updates.length} entries. Preview (first 10 and last 5):`)

  updates.slice(0, 10).forEach((u, idx) => {
    console.log(
      `${idx + 1}. ${u.entryNumber} | old: ${u.oldCreatedAt.toISOString()} → new: ${u.newCreatedAt.toISOString()}`
    )
  })
  if (updates.length > 15) {
    console.log('...')
    updates.slice(-5).forEach((u, idx) => {
      const realIdx = updates.length - 5 + idx
      console.log(
        `${realIdx + 1}. ${u.entryNumber} | old: ${u.oldCreatedAt.toISOString()} → new: ${u.newCreatedAt.toISOString()}`
      )
    })
  }

  if (!execute) {
    console.log('\nDry run complete. Re-run with --execute to apply the new createdAt values.')
    return
  }

  console.log('\nApplying updates...')

  let updatedCount = 0
  for (const u of updates) {
    await prisma.journalEntry.update({
      where: { id: u.id },
      data: { createdAt: u.newCreatedAt },
    })
    updatedCount++
    if (updatedCount % 50 === 0) {
      console.log(`  ... updated ${updatedCount}/${updates.length}`)
    }
  }

  console.log(`\nDone. Updated ${updatedCount} entries.`)
  console.log('New createdAt values are spread randomly while respecting JE-2026-xxxx sequence order.')
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
