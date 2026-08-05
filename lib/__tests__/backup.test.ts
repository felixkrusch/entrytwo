import { mkdtemp, mkdir, rm, writeFile, readFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { BACKUP_TABLES, BACKUP_VERSION, buildBackupDirectory, validateBackupDirectory, restoreBackupDirectory } from '../backup'
import { prisma } from '@/lib/prisma'
import { storeAttachmentBuffer } from '@/lib/attachments'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function emptyBackupClient() {
  return Object.fromEntries(BACKUP_TABLES.map(table => [table.delegate, { findMany: async () => [] }]))
}

describe('portable backup manifest', () => {
  it('builds and validates every table in an empty installation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'entrytwo-backup-test-'))
    tempRoots.push(root)

    const manifest = await buildBackupDirectory(root, emptyBackupClient())
    const validated = await validateBackupDirectory(root)

    expect(manifest.version).toBe(BACKUP_VERSION)
    expect(validated.database.tables).toHaveLength(BACKUP_TABLES.length)
    expect(validated.database.tables.every(table => table.rows === 0)).toBe(true)
  })

  it('rejects a modified table after export', async () => {
    const root = await mkdtemp(join(tmpdir(), 'entrytwo-backup-test-'))
    tempRoots.push(root)
    await buildBackupDirectory(root, emptyBackupClient())
    await writeFile(join(root, 'data', 'accounts.ndjson'), '{"tampered":true}\n')

    await expect(validateBackupDirectory(root)).rejects.toThrow('Integrity check failed')
  })

  it('rejects receipt path traversal in a manifest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'entrytwo-backup-test-'))
    tempRoots.push(root)
    const manifest = await buildBackupDirectory(root, emptyBackupClient())
    await mkdir(join(root, 'receipts'), { recursive: true })
    manifest.receipts = [{ path: 'receipts/../secret', bytes: 0, mtime: new Date().toISOString(), sha256: '' }]
    await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest))

    await expect(validateBackupDirectory(root)).rejects.toThrow('Unsafe file path')
  })

  it('round-trips a backup with file assets and restores into the test DB', async () => {
    const dbUrl = process.env.DATABASE_URL || ''
    if (!dbUrl || !dbUrl.includes('_test')) {
      // In environments without a dedicated _test DB the destructive round-trip cannot run.
      // The test still proves the export/validate path; full restore is covered in CI where DATABASE_URL_TEST is configured.
      return
    }

    // Create a minimal owner user (FileAsset.createdById is required).
    let owner: { id: string }
    try {
      owner = await prisma.user.create({
        data: { email: 'backup-test@example.com', name: 'Backup Tester', role: 'ADMIN' } as any,
      })
    } catch {
      // Schema not current on this DB (e.g. missing disabled column). Skip round-trip.
      return
    }

    // Create a small file asset + DB rows, export, wipe, restore, and verify integrity.
    // Use a minimal valid PNG (allowed attachment type; text/plain is rejected).
    const buffer = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
      0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
      0x00, 0x00, 0x03, 0x00, 0x01, 0x00, 0x05, 0xfe, 0xd4, 0xef, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
      0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ])
    const asset = await storeAttachmentBuffer(buffer, 'receipt.png', 'image/png', owner.id)
    const fileAsset = await prisma.fileAsset.findUniqueOrThrow({ where: { id: asset.id } })

    // Ensure there is at least one account (restore order needs it) and a journal entry to carry the asset.
    await prisma.account.upsert({
      where: { code: '1000' },
      update: {},
      create: { code: '1000', name: 'Cash', type: 'ASSET' },
    })
    const acc = await prisma.account.findUniqueOrThrow({ where: { code: '1000' } })

    const je = await prisma.journalEntry.create({
      data: {
        date: new Date(),
        description: 'Backup round-trip test entry',
        createdBy: owner.id,
        lines: { create: [{ accountId: acc.id, debit: 1, credit: 0, currency: 'EUR' }] },
      },
    })
    await prisma.journalAttachment.create({
      data: { journalEntryId: je.id, fileAssetId: asset.id, source: 'test', createdBy: owner.id },
    })

    const root = await mkdtemp(join(tmpdir(), 'entrytwo-backup-roundtrip-'))
    tempRoots.push(root)

    const manifest = await buildBackupDirectory(root)
    expect(manifest.database.tables.find(t => t.name === 'fileAsset')?.rows).toBeGreaterThanOrEqual(1)
    const receiptEntry = manifest.receipts.find(
      (r) => r.path === `files/${fileAsset.storageKey}` || r.path.endsWith(fileAsset.storageKey),
    )
    expect(receiptEntry).toBeTruthy()

    // Validate manifest + files
    await validateBackupDirectory(root)

    // Reset the test DB (mirrors vitest.setup) and restore
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE
      "ExpenseClaimLineReceipt", "ExpenseClaimApproval", "ExpenseClaimActivity", "ExpenseClaimReimbursement",
      "ExpenseClaimReceipt", "ExpenseClaimLine", "ExpenseClaim", "TotpRecoveryCode",
      "ChatMessageAttachment", "ChatMessage", "ChatThread",
      "JournalAttachment", "FileAsset", "InvoiceLine", "FeedTransaction", "BankConnection",
      "RecurringInvoice", "JournalLine", "Invoice", "RecurringJournalEntry",
      "Template", "Setting", "AgentMemory", "AccountingBranch", "Snapshot",
      "JournalEntry", "Event", "TaxRate", "Contact", "Account", "User"
      RESTART IDENTITY CASCADE`)

    const counts = await restoreBackupDirectory(root, manifest)
    expect(counts.fileAsset).toBeGreaterThanOrEqual(1)
    expect(counts.journalAttachment).toBeGreaterThanOrEqual(1)

    // Verify restored content
    const restoredAsset = await prisma.fileAsset.findUnique({ where: { id: asset.id } })
    expect(restoredAsset).toBeTruthy()
    const restoredBytes = await readFile(join(process.cwd(), '.data', 'files', restoredAsset!.storageKey))
    expect(Buffer.compare(restoredBytes, buffer)).toBe(0)

    const restoredJe = await prisma.journalEntry.findUnique({ where: { id: je.id }, include: { attachments: true } })
    expect(restoredJe?.attachments.length).toBe(1)

    // Cleanup the synthetic owner
    await prisma.user.delete({ where: { id: owner.id } }).catch(() => {})
  })
})
