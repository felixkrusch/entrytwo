import { createReadStream } from 'fs'
import { mkdtemp, rm, stat } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { Readable } from 'stream'
import * as tar from 'tar'
import { auth } from '@/lib/auth'
import { BACKUP_CONTENT_TYPE, BACKUP_EXTENSION, buildBackupDirectory } from '@/lib/backup'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await auth()
  if (session?.user?.role !== 'ADMIN') return Response.json({ error: 'Admin access required' }, { status: 403 })

  const tempRoot = await mkdtemp(join(tmpdir(), 'entrytwo-export-'))
  const contentRoot = join(tempRoot, 'content')
  const archivePath = join(tempRoot, `backup${BACKUP_EXTENSION}`)
  try {
    const manifest = await prisma.$transaction(
      tx => buildBackupDirectory(contentRoot, tx),
      { isolationLevel: 'RepeatableRead', maxWait: 60_000, timeout: Number(process.env.BACKUP_TRANSACTION_TIMEOUT_MS || 2 * 60 * 60_000) },
    )
    await tar.c({ gzip: true, cwd: contentRoot, file: archivePath, portable: true }, ['manifest.json', 'data', 'receipts'])
    const archiveSize = (await stat(archivePath)).size
    const filename = `entrytwo-full-backup-${manifest.exportedAt.slice(0, 10)}${BACKUP_EXTENSION}`
    const stream = createReadStream(archivePath)
    stream.on('close', () => void rm(tempRoot, { recursive: true, force: true }))
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      headers: {
        'Content-Type': BACKUP_CONTENT_TYPE,
        'Content-Length': String(archiveSize),
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    await rm(tempRoot, { recursive: true, force: true })
    logger.error('Portable backup export failed', { error: error instanceof Error ? error.message : String(error) })
    return Response.json({ error: error instanceof Error ? error.message : 'Failed to export backup' }, { status: 500 })
  }
}
