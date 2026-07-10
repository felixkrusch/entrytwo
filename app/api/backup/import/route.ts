import { createWriteStream } from 'fs'
import { mkdir, mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { Readable } from 'stream'
import * as tar from 'tar'
import { auth } from '@/lib/auth'
import { BACKUP_EXTENSION, restoreBackupDirectory, validateBackupDirectory } from '@/lib/backup'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DEFAULT_MAX_BYTES = 50 * 1024 * 1024 * 1024

async function saveRequestBody(request: Request, target: string, maxBytes: number): Promise<void> {
  if (!request.body) throw new Error('Backup file is required')
  const declared = Number(request.headers.get('content-length') || 0)
  if (declared > maxBytes) throw new Error(`Backup exceeds the configured ${maxBytes} byte limit`)

  const input = Readable.fromWeb(request.body as never)
  const output = createWriteStream(target, { flags: 'wx' })
  let received = 0
  await new Promise<void>((resolve, reject) => {
    input.on('data', (chunk: Buffer) => {
      received += chunk.length
      if (received > maxBytes) input.destroy(new Error(`Backup exceeds the configured ${maxBytes} byte limit`))
    })
    input.on('error', reject)
    output.on('error', reject)
    output.on('finish', resolve)
    input.pipe(output)
  })
}

export async function POST(request: Request) {
  const session = await auth()
  if (session?.user?.role !== 'ADMIN') return Response.json({ error: 'Admin access required' }, { status: 403 })
  if (request.headers.get('x-entrytwo-confirm-replace') !== 'replace-all-data') {
    return Response.json({ error: 'Explicit full-replacement confirmation is required' }, { status: 400 })
  }

  const tempRoot = await mkdtemp(join(tmpdir(), 'entrytwo-import-'))
  const archivePath = join(tempRoot, `upload${BACKUP_EXTENSION}`)
  const contentRoot = join(tempRoot, 'content')
  try {
    await mkdir(contentRoot, { recursive: true })
    const configuredMax = Number(process.env.BACKUP_MAX_IMPORT_BYTES || DEFAULT_MAX_BYTES)
    await saveRequestBody(request, archivePath, Number.isFinite(configuredMax) ? configuredMax : DEFAULT_MAX_BYTES)
    let extractedBytes = 0
    const maxExtractedBytes = Number(process.env.BACKUP_MAX_EXTRACTED_BYTES || DEFAULT_MAX_BYTES * 2)
    await tar.x({
      file: archivePath,
      cwd: contentRoot,
      strict: true,
      preservePaths: false,
      onentry: entry => {
        extractedBytes += entry.size
        if (extractedBytes > maxExtractedBytes) throw new Error(`Expanded backup exceeds the configured ${maxExtractedBytes} byte limit`)
      },
      filter: path => path === 'manifest.json' || path === 'data' || path.startsWith('data/') || path === 'receipts' || path.startsWith('receipts/'),
    })
    const manifest = await validateBackupDirectory(contentRoot)
    const imported = await restoreBackupDirectory(contentRoot, manifest)
    return Response.json({ ok: true, version: manifest.version, exportedAt: manifest.exportedAt, imported })
  } catch (error) {
    console.error('Portable backup import failed:', error)
    return Response.json({ error: error instanceof Error ? error.message : 'Failed to import backup' }, { status: 400 })
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
}
