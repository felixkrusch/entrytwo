import { createHash, randomUUID } from 'crypto'
import { mkdir, readFile, unlink, writeFile } from 'fs/promises'
import { extname, join } from 'path'
import { ALLOWED_ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES, validateAttachment } from '@/lib/attachments'

const claimFilesDir = join(process.cwd(), '.data', 'expense-claims')

export async function storeClaimFile(file: File) {
  const buffer = Buffer.from(await file.arrayBuffer())
  const { mimeType, extension } = validateAttachment(file, buffer)
  return storeClaimBuffer(buffer, file.name, mimeType, extension)
}

export async function storeClaimBuffer(buffer: Buffer, originalName: string, mimeType: string, forcedExtension?: string) {
  const extension = forcedExtension || ALLOWED_ATTACHMENT_TYPES.get(mimeType) || extname(originalName).toLowerCase()
  if (!ALLOWED_ATTACHMENT_TYPES.has(mimeType) || !extension) throw new Error(`${originalName} is not a supported receipt file`)
  await mkdir(claimFilesDir, { recursive: true })
  const storageKey = `${randomUUID()}${extension}`
  await writeFile(join(claimFilesDir, storageKey), buffer, { flag: 'wx' })
  return {
    storageKey,
    originalName: (originalName || storageKey).slice(0, 255),
    mimeType,
    size: buffer.length,
    sha256: createHash('sha256').update(buffer).digest('hex'),
  }
}

export async function readClaimFile(storageKey: string) {
  if (!/^[a-f0-9-]+\.[a-z0-9]+$/i.test(storageKey)) throw new Error('Invalid storage key')
  return readFile(join(claimFilesDir, storageKey))
}

export async function deleteClaimFile(storageKey: string) {
  if (!/^[a-f0-9-]+\.[a-z0-9]+$/i.test(storageKey)) return
  await unlink(join(claimFilesDir, storageKey)).catch(() => undefined)
}

export function validateClaimFileSelection(files: File[]) {
  if (!files.length) throw new Error('No files selected')
  for (const file of files) {
    if (!file.size || file.size > MAX_ATTACHMENT_BYTES) throw new Error(`${file.name} exceeds the file size limit`)
    const extension = extname(file.name).toLowerCase()
    if (![...ALLOWED_ATTACHMENT_TYPES.values()].includes(extension)) throw new Error(`${file.name} is not a supported receipt file`)
  }
}
