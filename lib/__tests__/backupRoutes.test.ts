import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { afterEach, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/backup/export/route'
import { POST } from '@/app/api/backup/import/route'
import { BACKUP_TABLES, buildBackupDirectory, validateBackupDirectory } from '../backup'

const { transaction } = vi.hoisted(() => ({ transaction: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: transaction } }))
vi.mock('@/lib/encryption', () => ({ encryptionKeyFingerprint: () => 'test-key-fingerprint' }))
vi.mock('@/lib/auth', () => ({ auth: async () => ({ user: { role: 'ADMIN' } }) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: async () => null }))

let root: string | undefined
afterEach(async () => {
  vi.restoreAllMocks()
  transaction.mockReset()
  if (root) await rm(root, { recursive: true, force: true })
})

it('round-trips closed periods and attachment bytes through the download and upload routes', async () => {
  root = await mkdtemp(join(tmpdir(), 'entrytwo-backup-routes-'))
  vi.spyOn(process, 'cwd').mockReturnValue(root)
  const files = join(root, '.data', 'files')
  const attachment = Buffer.from('synthetic attachment bytes')
  const storageKey = 'receipt.pdf'
  await mkdir(files, { recursive: true })
  await writeFile(join(files, storageKey), attachment)

  const user = { id: 'owner' }
  const period = {
    id: 'period', name: 'January', status: 'CLOSED', closedById: user.id,
    startDate: new Date('2026-01-01'), endDate: new Date('2026-01-31'),
    closedAt: new Date('2026-02-01'), createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-02-01'),
  }
  const rows: Record<string, object[]> = {
    user: [user], accountingPeriod: [period], fileAsset: [{ id: 'file', storageKey }],
  }
  const tx = Object.fromEntries(BACKUP_TABLES.map(({ delegate }) => [delegate, {
    findMany: async () => rows[delegate] ?? [],
    deleteMany: vi.fn(),
    createMany: vi.fn(),
  }]))
  transaction.mockImplementation(async (run: (client: unknown) => Promise<unknown>) => run(tx))

  const download = await GET()
  expect(download.status).toBe(200)
  expect(download.headers.get('content-disposition')).toMatch(/^attachment; filename="entrytwo-full-backup-\d{4}-\d{2}-\d{2}\.etbackup"$/)
  expect(download.headers.get('content-type')).toBe('application/gzip')
  const archive = await download.arrayBuffer()
  expect([...new Uint8Array(archive, 0, 2)]).toEqual([0x1f, 0x8b])
  await rm(join(files, storageKey))

  const restored = await POST(new NextRequest('http://localhost/api/backup/import', {
    method: 'POST', body: archive, headers: { 'x-entrytwo-confirm-replace': 'replace-all-data' },
  }))
  expect(await restored.json()).toMatchObject({ ok: true, imported: { accountingPeriod: 1, fileAsset: 1, receipts: 1 } })
  expect(restored.status).toBe(200)
  expect(tx.accountingPeriod.deleteMany).toHaveBeenCalledBefore(tx.user.deleteMany)
  expect(tx.user.createMany).toHaveBeenCalledBefore(tx.accountingPeriod.createMany)
  expect(tx.accountingPeriod.createMany).toHaveBeenCalledWith({ data: [period] })
  expect(await readFile(join(files, storageKey))).toEqual(attachment)
})

it('rejects old backups explicitly rather than restoring without closed periods', async () => {
  root = await mkdtemp(join(tmpdir(), 'entrytwo-legacy-backup-'))
  await writeFile(join(root, 'manifest.json'), JSON.stringify({ format: 'entrytwo-portable-backup', version: 4 }))
  await expect(validateBackupDirectory(root)).rejects.toThrow('Version 4 backups omit accounting periods')
})

it('rejects a current manifest that omits accounting periods', async () => {
  root = await mkdtemp(join(tmpdir(), 'entrytwo-incomplete-backup-'))
  vi.spyOn(process, 'cwd').mockReturnValue(root)
  const client = Object.fromEntries(BACKUP_TABLES.map(({ delegate }) => [delegate, { findMany: async () => [] }]))
  const manifest = await buildBackupDirectory(root, client)
  manifest.database.tables = manifest.database.tables.filter(table => table.name !== 'accountingPeriod')
  await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest))
  await expect(validateBackupDirectory(root)).rejects.toThrow('Backup is missing tables: accountingPeriod')
})
