import { mkdtemp, mkdir, rm, writeFile, readFile } from 'fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BACKUP_TABLES, BACKUP_VERSION, buildBackupDirectory, validateBackupDirectory, restoreBackupDirectory } from '../backup'
import { prisma } from '@/lib/prisma'

const tempRoots: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(tempRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function makeTempRoot(prefix = 'entrytwo-backup-test-') {
  const root = await mkdtemp(join(tmpdir(), prefix))
  tempRoots.push(root)
  return root
}

beforeEach(async () => {
  vi.spyOn(process, 'cwd').mockReturnValue(await makeTempRoot('entrytwo-backup-storage-'))
})

function emptyBackupClient() {
  return Object.fromEntries(BACKUP_TABLES.map(table => [table.delegate, { findMany: async () => [] }]))
}

describe('portable backup manifest', () => {
  it('builds and validates every table in an empty installation', async () => {
    const root = await makeTempRoot()

    const manifest = await buildBackupDirectory(root, emptyBackupClient())
    const validated = await validateBackupDirectory(root)

    expect(manifest.version).toBe(BACKUP_VERSION)
    expect(validated.database.tables).toHaveLength(BACKUP_TABLES.length)
    expect(validated.database.tables.every(table => table.rows === 0)).toBe(true)
  })

  it('rejects a modified table after export', async () => {
    const root = await makeTempRoot()
    await buildBackupDirectory(root, emptyBackupClient())
    await writeFile(join(root, 'data', 'accounts.ndjson'), '{"tampered":true}\n')

    await expect(validateBackupDirectory(root)).rejects.toThrow('Integrity check failed')
  })

  it('rejects receipt path traversal in a manifest', async () => {
    const root = await makeTempRoot()
    const manifest = await buildBackupDirectory(root, emptyBackupClient())
    await mkdir(join(root, 'receipts'), { recursive: true })
    manifest.receipts = [{ path: 'receipts/../secret', bytes: 0, mtime: new Date().toISOString(), sha256: '' }]
    await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest))

    await expect(validateBackupDirectory(root)).rejects.toThrow('Unsafe file path')
  })

  it('round-trips a backup with file assets and restores into the test DB', async () => {
    const dbUrl = new URL(process.env.DATABASE_URL || '')
    if (!dbUrl.pathname.endsWith('_test')) throw new Error('Backup restore tests require a disposable *_test database')

    const owner = await prisma.user.create({
      data: { email: 'backup-test@example.com', name: 'Backup Tester', role: 'ADMIN' },
    })
    const period = await prisma.accountingPeriod.create({ data: {
      name: 'January close', startDate: new Date('2026-01-01'), endDate: new Date('2026-01-31'),
      status: 'CLOSED', closedAt: new Date('2026-02-01'), closedById: owner.id,
    } })

    const buffer = Buffer.from('date,amount\n2026-02-01,1.00\n')
    const storageKey = 'receipt.csv'
    const files = join(process.cwd(), '.data', 'files')
    await mkdir(files, { recursive: true })
    await writeFile(join(files, storageKey), buffer)
    const fileAsset = await prisma.fileAsset.create({ data: {
      storageKey, originalName: storageKey, mimeType: 'text/csv', size: buffer.length,
      sha256: createHash('sha256').update(buffer).digest('hex'), createdById: owner.id,
    } })

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
      data: { journalEntryId: je.id, fileAssetId: fileAsset.id, source: 'test', createdBy: owner.id },
    })

    const root = await makeTempRoot('entrytwo-backup-roundtrip-')

    const manifest = await buildBackupDirectory(root)
    expect(manifest.database.tables.find(t => t.name === 'fileAsset')?.rows).toBeGreaterThanOrEqual(1)
    const receiptEntry = manifest.receipts.find(
      (r) => r.path === `files/${fileAsset.storageKey}` || r.path.endsWith(fileAsset.storageKey),
    )
    expect(receiptEntry).toBeTruthy()

    // Validate manifest + files
    await validateBackupDirectory(root)
    await rm(join(files, storageKey))

    // Restore over the existing rows to exercise foreign-key deletion order too.
    const counts = await restoreBackupDirectory(root, manifest)
    expect(counts.fileAsset).toBeGreaterThanOrEqual(1)
    expect(counts.journalAttachment).toBeGreaterThanOrEqual(1)
    expect(counts.accountingPeriod).toBe(1)
    expect(await prisma.accountingPeriod.findUnique({ where: { id: period.id } })).toEqual(period)

    // Verify restored content
    const restoredAsset = await prisma.fileAsset.findUnique({ where: { id: fileAsset.id } })
    expect(restoredAsset).toBeTruthy()
    const restoredBytes = await readFile(join(process.cwd(), '.data', 'files', restoredAsset!.storageKey))
    expect(Buffer.compare(restoredBytes, buffer)).toBe(0)

    const restoredJe = await prisma.journalEntry.findUnique({ where: { id: je.id }, include: { attachments: true } })
    expect(restoredJe?.attachments.length).toBe(1)
  })
})
