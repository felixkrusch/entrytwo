// vitest.setup.ts
// Git Model integration tests assume a CLEAN database (they assert "main starts empty",
// exact visible-entry counts, and balance totals). They share one real Postgres DB, so
// without a reset they contaminate each other across files. This setup wipes the
// Git-model tables before EVERY test file (files run sequentially via fileParallelism:false),
// giving each file a fresh slate. It only touches the dedicated test database.
import 'dotenv/config'
import { prisma } from '@/lib/prisma'
import { ensureMainBranch } from '@/lib/accounting/branch'

export const setupTestDb = async () => {
  // Delete Git-model data in FK-safe order (children first). Cascading raw SQL was
  // fragile (table-name drift); Prisma deleteMany uses the real model names.
  await prisma.journalLine.deleteMany({})
  await prisma.journalEntry.deleteMany({})
  await prisma.accountingBranch.deleteMany({})
  await prisma.event.deleteMany({})
  await prisma.snapshot.deleteMany({})
  await ensureMainBranch()
}

beforeAll(async () => {
  try {
    await prisma.$connect()
    await setupTestDb()
  } catch (e) {
    console.error('vitest.setup: failed to reset test DB', e)
  }
})
