// vitest.setup.ts
// Git Model integration tests assume a CLEAN database (they assert "main starts empty",
// exact visible-entry counts, and balance totals). They share one real Postgres DB, so
// without a reset they contaminate each other across files. Vitest config requires
// a separate *_test database before this module is loaded.
import 'dotenv/config'
import { beforeAll } from 'vitest'
import { prisma } from '@/lib/prisma'
import { ensureMainBranch } from '@/lib/accounting/branch'

export const setupTestDb = async () => {
  const databaseName = new URL(process.env.DATABASE_URL || '').pathname.slice(1)
  if (!databaseName.endsWith('_test')) throw new Error(`Refusing to reset non-test database: ${databaseName}`)
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE
    "JournalAttachment", "InvoiceLine", "FeedTransaction", "BankConnection",
    "RecurringInvoice", "JournalLine", "Invoice", "RecurringJournalEntry",
    "Template", "Setting", "AgentMemory", "AccountingBranch", "Snapshot",
    "JournalEntry", "Event", "TaxRate", "Contact", "Account", "User"
    RESTART IDENTITY CASCADE`)
  await prisma.account.createMany({ data: [
    { code: '1000', name: 'Cash', type: 'ASSET' },
    { code: '4000', name: 'Sales / Service Revenue', type: 'REVENUE' },
  ] })
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
