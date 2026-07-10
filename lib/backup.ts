import { createHash } from 'crypto'
import { createReadStream } from 'fs'
import { appendFile, copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'fs/promises'
import { basename, join } from 'path'
import { createInterface } from 'readline'
import { prisma } from '@/lib/prisma'
import { encryptionKeyFingerprint } from '@/lib/encryption'

export const BACKUP_VERSION = 3
export const BACKUP_EXTENSION = '.etbackup'
export const BACKUP_CONTENT_TYPE = 'application/gzip'
export const BACKUP_PAGE_SIZE = 1000

type BackupDelegate = {
  findMany(args: Record<string, unknown>): Promise<Record<string, unknown>[]>
  createMany(args: { data: Record<string, unknown>[] }): Promise<{ count: number }>
  deleteMany(): Promise<{ count: number }>
}

type TableDefinition = {
  file: string
  delegate: string
  orderBy: Record<string, 'asc'> | Array<Record<string, 'asc'>>
  dateFields?: string[]
}

// Dependency order for restore. IDs are preserved exactly, so every relationship
// and Git-model pointer remains valid on a fresh installation.
export const BACKUP_TABLES: TableDefinition[] = [
  { file: 'users', delegate: 'user', orderBy: { id: 'asc' }, dateFields: ['createdAt', 'updatedAt'] },
  { file: 'accounts', delegate: 'account', orderBy: { id: 'asc' }, dateFields: ['createdAt', 'updatedAt'] },
  { file: 'contacts', delegate: 'contact', orderBy: { id: 'asc' }, dateFields: ['vatValidatedAt', 'createdAt', 'updatedAt'] },
  { file: 'tax-rates', delegate: 'taxRate', orderBy: { id: 'asc' }, dateFields: ['effectiveFrom', 'effectiveTo', 'createdAt', 'updatedAt'] },
  { file: 'journal-entries', delegate: 'journalEntry', orderBy: { id: 'asc' }, dateFields: ['date', 'createdAt', 'updatedAt'] },
  { file: 'journal-attachments', delegate: 'journalAttachment', orderBy: { id: 'asc' }, dateFields: ['createdAt'] },
  { file: 'journal-lines', delegate: 'journalLine', orderBy: { id: 'asc' }, dateFields: ['fxDate'] },
  { file: 'invoices', delegate: 'invoice', orderBy: { id: 'asc' }, dateFields: ['issueDate', 'dueDate', 'paidDate', 'createdAt', 'updatedAt'] },
  { file: 'invoice-lines', delegate: 'invoiceLine', orderBy: { id: 'asc' } },
  { file: 'recurring-invoices', delegate: 'recurringInvoice', orderBy: { id: 'asc' }, dateFields: ['startDate', 'endDate', 'nextDueDate', 'lastGeneratedAt', 'createdAt', 'updatedAt'] },
  { file: 'recurring-journal-entries', delegate: 'recurringJournalEntry', orderBy: { id: 'asc' }, dateFields: ['startDate', 'nextDueDate', 'lastGeneratedAt', 'endDate', 'createdAt', 'updatedAt'] },
  { file: 'templates', delegate: 'template', orderBy: { id: 'asc' }, dateFields: ['createdAt', 'updatedAt'] },
  { file: 'settings', delegate: 'setting', orderBy: { id: 'asc' }, dateFields: ['createdAt', 'updatedAt'] },
  { file: 'bank-connections', delegate: 'bankConnection', orderBy: { id: 'asc' }, dateFields: ['lastSyncAt', 'createdAt', 'updatedAt'] },
  { file: 'feed-transactions', delegate: 'feedTransaction', orderBy: { id: 'asc' }, dateFields: ['date', 'createdAt'] },
  { file: 'agent-memories', delegate: 'agentMemory', orderBy: { id: 'asc' }, dateFields: ['createdAt', 'updatedAt'] },
  { file: 'events', delegate: 'event', orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], dateFields: ['createdAt'] },
  { file: 'snapshots', delegate: 'snapshot', orderBy: { id: 'asc' }, dateFields: ['createdAt'] },
  { file: 'accounting-branches', delegate: 'accountingBranch', orderBy: { id: 'asc' }, dateFields: ['createdAt', 'updatedAt'] },
]

const DELETE_ORDER = [
  'invoiceLine', 'feedTransaction', 'bankConnection', 'recurringInvoice', 'journalAttachment', 'journalLine',
  'invoice', 'recurringJournalEntry', 'template', 'setting', 'agentMemory',
  'accountingBranch', 'snapshot', 'journalEntry', 'event', 'taxRate', 'contact', 'account', 'user',
]

export type BackupManifest = {
  format: 'entrytwo-portable-backup'
  version: number
  exportedAt: string
  appVersion: string
  encryptionKeyFingerprint: string
  database: { tables: Array<{ name: string; file: string; rows: number; bytes: number; sha256: string }> }
  receipts: Array<{ path: string; bytes: number; mtime: string; sha256: string }>
}

function delegate(client: unknown, name: string): BackupDelegate {
  return (client as Record<string, BackupDelegate>)[name]
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', resolve)
  })
  return hash.digest('hex')
}

export async function buildBackupDirectory(root: string, client: unknown = prisma): Promise<BackupManifest> {
  const dataDir = join(root, 'data')
  const receiptsOut = join(root, 'receipts')
  await mkdir(dataDir, { recursive: true })
  await mkdir(receiptsOut, { recursive: true })

  const tables: BackupManifest['database']['tables'] = []
  const referencedReceipts = new Set<string>()
  for (const table of BACKUP_TABLES) {
    const output = join(dataDir, `${table.file}.ndjson`)
    await writeFile(output, '')
    let cursor: string | undefined
    let rows = 0
    while (true) {
      const page = await delegate(client, table.delegate).findMany({
        orderBy: table.orderBy,
        take: BACKUP_PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      })
      if (page.length === 0) break
      await appendFile(output, page.map(record => JSON.stringify(record)).join('\n') + '\n')
      if (table.delegate === 'journalEntry') {
        for (const record of page) {
          if (typeof record.sourcePdfPath === 'string' && record.sourcePdfPath.startsWith('/uploads/receipts/')) {
            referencedReceipts.add(record.sourcePdfPath.slice('/uploads/receipts/'.length))
          }
        }
      }
      if (table.delegate === 'journalAttachment') {
        for (const record of page) {
          if (typeof record.path === 'string' && record.path.startsWith('/uploads/receipts/')) {
            referencedReceipts.add(record.path.slice('/uploads/receipts/'.length))
          }
        }
      }
      rows += page.length
      cursor = String(page[page.length - 1].id)
      if (page.length < BACKUP_PAGE_SIZE) break
    }
    const info = await stat(output)
    tables.push({ name: table.delegate, file: `data/${table.file}.ndjson`, rows, bytes: info.size, sha256: await sha256File(output) })
  }

  const receipts: BackupManifest['receipts'] = []
  const receiptSource = join(process.cwd(), 'public', 'uploads', 'receipts')
  const names = await readdir(receiptSource).catch(() => [])
  for (const name of names.sort()) {
    if (name.startsWith('.') || basename(name) !== name) continue
    const source = join(receiptSource, name)
    const info = await stat(source).catch(() => null)
    if (!info?.isFile()) continue
    const target = join(receiptsOut, name)
    await copyFile(source, target)
    receipts.push({ path: `receipts/${name}`, bytes: info.size, mtime: info.mtime.toISOString(), sha256: await sha256File(target) })
  }

  const copiedReceiptNames = new Set(receipts.map(receipt => basename(receipt.path)))
  const missingReceipts = Array.from(referencedReceipts).filter(name => !copiedReceiptNames.has(name))
  if (missingReceipts.length) {
    throw new Error(`Cannot create a complete backup: ${missingReceipts.length} referenced receipt file(s) are missing (${missingReceipts.slice(0, 5).join(', ')})`)
  }

  const manifest: BackupManifest = {
    format: 'entrytwo-portable-backup',
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: process.env.APP_VERSION || process.env.npm_package_version || 'unknown',
    encryptionKeyFingerprint: encryptionKeyFingerprint(),
    database: { tables },
    receipts,
  }
  await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest, null, 2))
  return manifest
}

export async function validateBackupDirectory(root: string): Promise<BackupManifest> {
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')) as BackupManifest
  if (manifest.format !== 'entrytwo-portable-backup' || manifest.version !== BACKUP_VERSION) {
    throw new Error(`Unsupported backup format or version (expected ${BACKUP_VERSION})`)
  }
  if (manifest.encryptionKeyFingerprint !== encryptionKeyFingerprint()) {
    throw new Error('This backup was created with a different ENCRYPTION_KEY. Configure the original key on this installation before restoring.')
  }
  if (!Array.isArray(manifest.database?.tables) || !Array.isArray(manifest.receipts)) throw new Error('Backup manifest is incomplete')

  const expectedTables = new Set(BACKUP_TABLES.map(table => table.delegate))
  for (const table of manifest.database.tables) {
    if (!expectedTables.delete(table.name)) throw new Error(`Unexpected or duplicate backup table: ${table.name}`)
    const path = join(root, table.file)
    const info = await stat(path)
    if (!info.isFile() || info.size !== table.bytes || await sha256File(path) !== table.sha256) {
      throw new Error(`Integrity check failed for ${table.file}`)
    }
  }
  if (expectedTables.size) throw new Error(`Backup is missing tables: ${Array.from(expectedTables).join(', ')}`)

  for (const receipt of manifest.receipts) {
    if (!/^receipts\/[a-zA-Z0-9_.-]+$/.test(receipt.path) || receipt.path.includes('..')) throw new Error(`Unsafe receipt path: ${receipt.path}`)
    const path = join(root, receipt.path)
    const info = await stat(path)
    if (!info.isFile() || info.size !== receipt.bytes || await sha256File(path) !== receipt.sha256) {
      throw new Error(`Integrity check failed for ${receipt.path}`)
    }
  }


  const receiptNames = new Set(manifest.receipts.map(receipt => basename(receipt.path)))
  for await (const records of readNdjsonChunks(join(root, 'data', 'journal-entries.ndjson'))) {
    for (const record of records) {
      if (typeof record.sourcePdfPath !== 'string' || !record.sourcePdfPath.startsWith('/uploads/receipts/')) continue
      const name = record.sourcePdfPath.slice('/uploads/receipts/'.length)
      if (!receiptNames.has(name)) throw new Error(`Backup is missing referenced receipt: ${name}`)
    }
  }
  for await (const records of readNdjsonChunks(join(root, 'data', 'journal-attachments.ndjson'))) {
    for (const record of records) {
      if (typeof record.path !== 'string' || !record.path.startsWith('/uploads/receipts/')) continue
      const name = record.path.slice('/uploads/receipts/'.length)
      if (!receiptNames.has(name)) throw new Error(`Backup is missing referenced attachment: ${name}`)
    }
  }
  return manifest
}

async function* readNdjsonChunks(path: string, chunkSize = BACKUP_PAGE_SIZE): AsyncGenerator<Record<string, unknown>[]> {
  let records: Record<string, unknown>[] = []
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity })
  for await (const line of lines) {
    if (!line.trim()) continue
    records.push(JSON.parse(line) as Record<string, unknown>)
    if (records.length >= chunkSize) {
      yield records
      records = []
    }
  }
  if (records.length) yield records
}

function restoreTypes(record: Record<string, unknown>, dateFields: string[] = []): Record<string, unknown> {
  const restored = { ...record }
  for (const field of dateFields) {
    if (typeof restored[field] === 'string') restored[field] = new Date(restored[field] as string)
  }
  return restored
}

export async function restoreBackupDirectory(root: string, manifest: BackupManifest): Promise<Record<string, number>> {
  const receiptRoot = join(process.cwd(), 'public', 'uploads')
  const receiptTarget = join(receiptRoot, 'receipts')
  const stagedReceipts = join(receiptRoot, `.receipts-restore-${Date.now()}`)
  await mkdir(stagedReceipts, { recursive: true })
  for (const receipt of manifest.receipts) {
    const name = basename(receipt.path)
    await copyFile(join(root, receipt.path), join(stagedReceipts, name))
  }

  const counts: Record<string, number> = {}
  await mkdir(receiptRoot, { recursive: true })
  const previous = join(receiptRoot, `.receipts-previous-${Date.now()}`)
  const hadExisting = await stat(receiptTarget).then(() => true).catch(() => false)
  let receiptsSwapped = false

  try {
    await prisma.$transaction(async tx => {
      for (const name of DELETE_ORDER) await delegate(tx, name).deleteMany()

      for (const table of BACKUP_TABLES) {
        let restoredRows = 0
        for await (const records of readNdjsonChunks(join(root, 'data', `${table.file}.ndjson`))) {
          const chunk = records.map(record => restoreTypes(record, table.dateFields))
          await delegate(tx, table.delegate).createMany({ data: chunk })
          restoredRows += chunk.length
        }
        const expected = manifest.database.tables.find(item => item.name === table.delegate)?.rows
        if (expected !== restoredRows) throw new Error(`Row count mismatch for ${table.delegate}: expected ${expected}, restored ${restoredRows}`)
        counts[table.delegate] = restoredRows
      }

      // Swap only after all database rows are ready. Throwing here rolls back the
      // transaction; the catch block restores the previous directory as well.
      if (hadExisting) await rename(receiptTarget, previous)
      await rename(stagedReceipts, receiptTarget)
      receiptsSwapped = true
    }, { maxWait: 60_000, timeout: Number(process.env.BACKUP_TRANSACTION_TIMEOUT_MS || 2 * 60 * 60_000) })

    if (hadExisting) await rm(previous, { recursive: true, force: true })
  } catch (error) {
    await rm(stagedReceipts, { recursive: true, force: true })
    if (receiptsSwapped) await rm(receiptTarget, { recursive: true, force: true }).catch(() => {})
    if (hadExisting && receiptsSwapped) await rename(previous, receiptTarget).catch(() => {})
    throw error
  }
  counts.receipts = manifest.receipts.length
  return counts
}
