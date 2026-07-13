import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { BACKUP_TABLES, BACKUP_VERSION, buildBackupDirectory, validateBackupDirectory } from '../backup'

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
})
