import { createHash, randomUUID } from 'crypto'
import { mkdir, writeFile } from 'fs/promises'
import { extname, join } from 'path'

export const MAX_ATTACHMENT_BYTES = Number(process.env.MAX_ATTACHMENT_BYTES || 25 * 1024 * 1024)
export const MAX_ATTACHMENTS_PER_UPLOAD = Number(process.env.MAX_ATTACHMENTS_PER_UPLOAD || 20)
export const MAX_ATTACHMENT_BATCH_BYTES = Number(process.env.MAX_ATTACHMENT_BATCH_BYTES || 100 * 1024 * 1024)

export const ALLOWED_ATTACHMENT_TYPES = new Map([
  ['application/pdf', '.pdf'],
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['text/csv', '.csv'],
])

export type StoredAttachment = {
  path: string
  originalName: string
  mimeType: string
  size: number
  sha256: string
}

function detectedMimeType(buffer: Buffer): string | null {
  if (buffer.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf'
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  return null
}

export function validateAttachment(file: File, buffer: Buffer): { mimeType: string; extension: string } {
  if (!file.size || file.size !== buffer.length) throw new Error(`Attachment ${file.name || 'file'} is empty or incomplete`)
  if (buffer.length > MAX_ATTACHMENT_BYTES) throw new Error(`${file.name} exceeds the ${Math.floor(MAX_ATTACHMENT_BYTES / 1024 / 1024)} MB file limit`)

  const claimed = (file.type || '').toLowerCase()
  const extension = extname(file.name || '').toLowerCase()
  const detected = detectedMimeType(buffer)
  const isCsv = claimed === 'text/csv' || extension === '.csv'
  const mimeType = detected || (isCsv ? 'text/csv' : '')
  const expectedExtension = ALLOWED_ATTACHMENT_TYPES.get(mimeType)
  if (!expectedExtension) throw new Error(`${file.name} is not an allowed PDF, image, or CSV file`)
  if (claimed && claimed !== 'application/octet-stream' && claimed !== mimeType) throw new Error(`${file.name} content does not match its MIME type`)
  return { mimeType, extension: expectedExtension }
}

export async function storeAttachment(file: File): Promise<StoredAttachment> {
  const buffer = Buffer.from(await file.arrayBuffer())
  const { mimeType, extension } = validateAttachment(file, buffer)
  const uploadsDir = join(process.cwd(), 'public', 'uploads', 'receipts')
  await mkdir(uploadsDir, { recursive: true })
  const filename = `${randomUUID()}${extension}`
  await writeFile(join(uploadsDir, filename), buffer, { flag: 'wx' })
  return {
    path: `/uploads/receipts/${filename}`,
    originalName: (file.name || filename).slice(0, 255),
    mimeType,
    size: buffer.length,
    sha256: createHash('sha256').update(buffer).digest('hex'),
  }
}

export function parseAttachmentInput(value: unknown): StoredAttachment[] {
  if (!Array.isArray(value)) return []
  return value.map((item, index) => {
    if (!item || typeof item !== 'object') throw new Error(`Attachment ${index + 1} is invalid`)
    const record = item as Record<string, unknown>
    const path = typeof record.path === 'string' ? record.path : typeof record.savedPath === 'string' ? record.savedPath : ''
    if (!/^\/uploads\/receipts\/[a-zA-Z0-9_.-]+$/.test(path) || path.includes('..')) throw new Error(`Attachment ${index + 1} has an invalid path`)
    return {
      path,
      originalName: String(record.originalName || record.name || path.split('/').pop() || 'attachment').slice(0, 255),
      mimeType: String(record.mimeType || 'application/octet-stream').slice(0, 100),
      size: Math.max(0, Number(record.size) || 0),
      sha256: String(record.sha256 || 'legacy-unverified').slice(0, 128),
    }
  })
}
