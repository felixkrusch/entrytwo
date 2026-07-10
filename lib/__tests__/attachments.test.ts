import { describe, expect, it } from 'vitest'
import { parseAttachmentInput, validateAttachment } from '../attachments'

describe('journal attachment validation', () => {
  it('accepts a PDF whose content matches its MIME type', () => {
    const bytes = Buffer.from('%PDF-1.7\nexample')
    const file = { name: 'statement.pdf', type: 'application/pdf', size: bytes.length } as File
    expect(validateAttachment(file, bytes)).toEqual({ mimeType: 'application/pdf', extension: '.pdf' })
  })

  it('rejects a disguised executable payload', () => {
    const bytes = Buffer.from('MZ executable')
    const file = { name: 'statement.pdf', type: 'application/pdf', size: bytes.length } as File
    expect(() => validateAttachment(file, bytes)).toThrow('not an allowed')
  })

  it('accepts only receipt-root paths in journal payloads', () => {
    expect(parseAttachmentInput([{
      path: '/uploads/receipts/123.pdf', originalName: 'receipt.pdf', mimeType: 'application/pdf', size: 10, sha256: 'abc',
    }])).toHaveLength(1)
    expect(() => parseAttachmentInput([{ path: '/etc/passwd' }])).toThrow('invalid path')
  })
})
